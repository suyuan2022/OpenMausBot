// suyuan fork: Gemini 4, driven by OpenMausBot through Antigravity, sometimes writes its thinking into the reply itself
// instead of sending it as thinking. Antigravity's own transcript has the same text in the model's output, so it comes
// from the model, not from how the stream is read here. The thinking opens the reply with a mark and is English; the
// reply, when there is one, is glued straight onto its end, often with no space:
//   💡 Thought\n Let's check where `x-analytics` is … (and VM just in case).看到你 MacBook 的 Chrome 里正开着…
// The marks seen so far: "💡 Thought" on a line of its own (2026-11-15, 13 replies in one turn), "🫧thought" the same
// way with the reply right after it and no thinking at all (2026-11-15, gemini-4-argon on High), "[-thought-]",
// "सिस्टम/thought:" with or without a few stray letters before it, and a "</thought>" that closes thinking with no
// opening tag (2026-11-10). A model is not told about any of them, so the list grows when a new one turns up.
// stripThoughtLeak() keeps only the reply. shared/system-message-guard.ts calls it, which covers both ends, as for
// tool-echo.ts: the server stores the reply without the thinking (server/drivers/acp/core.ts flushes every reply
// through that guard) and the chat draws replies stored before this without it. A reply that is only thinking becomes
// empty: the server stores nothing and the chat hides a stored one.

/** A mark at the very start of a reply. Only at the start, so a reply that talks about the marks keeps its words. */
/** "Thought" on a line of its own may have an emoji before it, and which one changes ("💡 Thought", "🫧thought"). */
const OPENING = /^\s*(?:(?:[^\p{L}\p{N}\s]{1,4}\s*)?Thought:?[ \t]*\r?\n|\[-thought-\]|[^\n`]{0,24}?\/thought:)/iu;
const CLOSING = "</thought>";
const HAN = /[㐀-䶿一-鿿]/;

/** Han characters against Latin letters, outside code, links and addresses: the reply is in Chinese, the thinking in English. */
function readsChinese(text: string): boolean {
  const words = text.replace(/```[\s\S]*?(?:```|$)/g, "").replace(/`[^`\n]*`/g, "").replace(/\]\([^)\s]*\)/g, "]")
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "");
  const han = words.match(/[㐀-䶿一-鿿]/g)?.length ?? 0;
  const latin = words.match(/[A-Za-z]/g)?.length ?? 0;
  return han > 0 && han >= latin;
}

/** English thinking runs a few words before its first Han character; a reply opens in Chinese, or with no more than
 * a name in code before it ("`vm_stat` 看下来，…"). */
function opensChinese(text: string): boolean {
  const han = text.search(HAN);
  if (han < 0) return false;
  const lead = text.slice(0, han).replace(/`[^`\n]*`/g, "").replace(/\]\([^)\s]*\)/g, "]");
  return (lead.match(/[A-Za-z]+/g)?.length ?? 0) < 3 && readsChinese(text);
}

/** Where the reply starts in what follows the mark: the first place the text turns to Chinese and stays Chinese.
 * It turns at the start, or right after an English sentence ends ("…in case).看到你"). -1 when it never does. */
function replyStart(rest: string): number {
  const first = rest.search(/\S/);
  if (first >= 0 && opensChinese(rest.slice(first))) return first;
  const turns = /[.!?)\]][ \t\r\n]*(?=[㐀-䶿一-鿿])/g;
  for (let m = turns.exec(rest); m; m = turns.exec(rest)) {
    const at = m.index + m[0].length;
    if (readsChinese(rest.slice(at))) return at;
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
  const opening = reply.match(OPENING);
  if (!opening) return reply;
  const rest = reply.slice(opening[0].length);
  const at = replyStart(rest);
  return at < 0 ? "" : rest.slice(at);
}

/** Whether a reply opens with, or holds, one of the marks: the chat hides a stored reply that was only thinking. */
export function hasThoughtMark(text: string): boolean {
  return OPENING.test(text) || closingAt(text) >= 0 || /<thought>[\s\S]*?<\/thought>/.test(text);
}
