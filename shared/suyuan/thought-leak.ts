// suyuan fork: Gemini 4, driven by OpenMausBot through Antigravity, sometimes writes its thinking into the reply itself.
// Antigravity sends every word as agent_message_chunk (not one agent_thought_chunk in the 2026-11-15 recording) and
// its own transcript keeps the thinking inside the reply text, so the model wrote it there and nothing on the wire
// tells the two apart. It happens on gemini-4-argon at High, which no longer runs (server/suyuan/argon-thinking.ts);
// this is the net under that. The thinking is English and opens the reply; the reply, when there is one, is Chinese
// and glued straight onto its end, often with no space:
//   💡 Thought\n Let's check where `x-analytics` is … (and VM just in case).看到你 MacBook 的 Chrome 里正开着…
// The model makes up a mark for it as it goes ("💡 Thought", "🫧thought", "सिस्टम/thought:", "[-thought-]", a
// "</thought>" with no opening tag) and the next reply in the turn copies whichever it used, so the cut does not go by
// the mark. It goes by the shape:
// - English sentences before the first Chinese character (outside code, links and addresses) are thinking; they are
//   cut with whatever stands before them, and the reply starts where the text turns to Chinese and stays Chinese.
// - A short label at the very start that says "thought" or "thinking", however it is decorated, ending the line, at a
//   colon, or glued to Chinese, is cut. When nothing Chinese follows it the whole reply was thinking and becomes
//   empty: the server stores nothing and the chat hides a stored one. With no such label an English reply stays.
// shared/system-message-guard.ts calls it, which covers both ends, as for tool-echo.ts: the server stores the reply
// without the thinking (server/drivers/acp/core.ts flushes every reply through that guard) and the chat draws replies
// stored before this without it.

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

/** "</thought>" outside code, in a reply with no "<thought>" before it: everything before it is thinking. */
function closingAt(text: string): number {
  const at = text.indexOf(CLOSING);
  if (at < 0) return -1;
  const before = text.slice(0, at);
  if (before.includes("<thought>") || (before.match(/`/g)?.length ?? 0) % 2 === 1) return -1;
  return at;
}

export function stripThoughtLeak(text: string): string {
  let reply = text.replace(/<thought>[\s\S]*?<\/thought>/g, "");
  const closing = closingAt(reply);
  if (closing >= 0) reply = reply.slice(closing + CLOSING.length);
  const label = reply.match(LABEL);
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
