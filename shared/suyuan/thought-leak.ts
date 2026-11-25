const CLOSING = "</thought>";
const HAN = /[㐀-䶿一-鿿]/;
const LABEL = /^\s*(?:[^\p{L}\p{N}\s]{1,4}\s*)?[^\s㐀-䶿一-鿿]{0,16}?(?:thoughts?|thinking)[^\p{L}\p{N}\s]{0,3}(?::[ \t]*|[ \t]*\r?\n|(?=[㐀-䶿一-鿿]))/iu;

/** The text with code, link targets and addresses blanked to spaces of the same length, so positions still line up. */
function words(text: string): string {
  const blank = (match: string) => " ".repeat(match.length);
  return text.replace(/```[\s\S]*?(?:```|$)/g, blank).replace(/`[^`\n]*`/g, blank).replace(/\]\([^)\s]*\)/g, blank)
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, blank).replace(/(?:~|\.{1,2})?\/[\w.@-]+(?:\/[\w.@-]+)+/g, blank);
}

/** Han characters against Latin letters, outside code, links and addresses: the reply is in Chinese, the thinking in English. */
function readsChinese(text: string): boolean {
  const plain = words(text);
  const han = plain.match(/[㐀-䶿一-鿿]/g)?.length ?? 0;
  const latin = plain.match(/[A-Za-z]/g)?.length ?? 0;
  return han > 0 && han >= latin;
}

/** English words before a position, outside code, links and addresses. */
function englishWords(lead: string): string[] {
  return words(lead).match(/[A-Za-z][A-Za-z']*/g) ?? [];
}

/** English sentences, not a name or two: product names ("Google Chrome Helper 进程"), a command or a short quote do
 * not count. Six words with four lowercase and a sentence that ends, or eight with five lowercase. */
function englishProse(lead: string): boolean {
  const all = englishWords(lead);
  const lower = all.filter((word) => /^[a-z]/.test(word)).length;
  return (all.length >= 8 && lower >= 5) || (all.length >= 6 && lower >= 4 && /[a-z)'"][.!?](?:\s|["')\]]|$)/.test(words(lead)));
}

/** Where the reply starts: the first place the text turns to Chinese and stays Chinese, right after an English sentence
 * ends ("…in case).看到你"). After a label, failing that, at the first Chinese character from which it stays Chinese;
 * without one an English reply naming something Chinese ("…search for 窒化熟铁锅 first.") stays whole. -1 if never. */
function replyStart(text: string, labelled: boolean): number {
  const plain = words(text);
  const turns = /[.!?)\]][ \t\r\n]*(?=[㐀-䶿一-鿿])/g;
  for (let m = turns.exec(plain); m; m = turns.exec(plain)) {
    const at = m.index + m[0].length;
    if (readsChinese(text.slice(at))) return at;
  }
  if (!labelled) return -1;
  const han = /[㐀-䶿一-鿿]/g;
  for (let m = han.exec(plain); m; m = han.exec(plain)) {
    if (readsChinese(text.slice(m.index))) return m.index;
  }
  return -1;
}

function stripThoughtTags(text: string): string {
  if (!text.includes(CLOSING)) return text;
  const plain = words(text);
  const kept: string[] = [];
  let start = 0, open = -1;
  for (const tag of plain.matchAll(/<\/?thought>/g)) {
    if (tag[0] !== CLOSING) {
      if (open < 0) open = tag.index;
    } else {
      if (open < 0) kept.length = 0;
      else kept.push(text.slice(start, open));
      start = tag.index + tag[0].length;
      open = -1;
    }
  }
  return kept.join("") + text.slice(start);
}

export function stripThoughtLeak(text: string): string {
  const reply = stripThoughtTags(text);
  const label = reply.match(LABEL);
  if (!label && (!HAN.test(reply) || /^\s*[㐀-䶿一-鿿]/.test(reply))) return reply;
  const rest = label ? reply.slice(label[0].length) : reply;
  const first = words(rest).search(HAN);
  // After a label any English before the Chinese is thinking; without one it has to read as English sentences.
  if (first < 0) return label ? "" : reply;
  const lead = rest.slice(0, first);
  if (label ? englishWords(lead).length < 3 : !englishProse(lead)) return label ? rest.trimStart() : reply;
  const at = replyStart(rest, Boolean(label));
  return at < 0 ? (label ? "" : reply) : rest.slice(at);
}

/** Whether a reply holds thinking by the same rules: the chat hides a stored reply that was only thinking. */
export function hasThoughtMark(text: string): boolean {
  return stripThoughtLeak(text) !== text;
}
