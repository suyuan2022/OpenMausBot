// suyuan fork: with one conversation per bot (./home.ts), a line a bot says along the way that is all English (Latin
// letters, no Chinese) is left out of the chat, a bot's and a room's alike. 夙愿 reads Chinese, and a "Checking the file
// now." between steps tells him nothing; he kept this filter on 11-15 (FORK.md), and the 11-24 rebuild dropped it by
// mistake. Ported from the v1 fork (PR #53).
//
// A turn's answer always shows, whatever its language: the server marks it (`turnTerminal`) as the turn ends, a change to
// the messages the chat's list is memoized on (src/components/ChatView.tsx), so the answer shows the moment its turn
// ends. Until then the turn's English lines stay out, the words still arriving too (src/state/live-reply.ts), rather than
// show and vanish; the working dots (./quiet-status.css) say the bot is at it. A turn that ended unmarked (the server
// stopped mid-turn) keeps its last line as its answer. A line with no turn keeps v1's rule: out once its bot has said
// something after it, before the person speaks again. A line that carries more than words stays (a file, a card, an
// automation's report), and so do the pinned message, the first unread one, a link, a table, a code block or math.
import { oneConversation } from "./home";

const CHINESE = /[㐀-鿿豈-﫿　-〿＀-￯]/;
const LATIN = /[A-Za-z]/;
/** A web or Markdown link, a code block, a table (a row in pipes, or the dashes under its header), display math. */
const KEPT = /https?:\/\/|\]\(|```|^\s*\|.*\|\s*$|^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$|\$\$|\\\[/m;
/** What a line of plain words carries. Anything else keeps the line, a field upstream adds later too. */
const PLAIN = new Set(["id", "at", "parentId", "role", "kind", "text", "turnId", "turnTerminal", "turnCompletedAt", "turnSucceeded", "from",
  "requestMessageId", "itemId", "routedBy", "sentInTurn", "steered", "via", "quickModel", "replyToId", "optimisticThreadOrderAt"]);

export function allEnglish(text: string): boolean {
  return LATIN.test(text) && !CHINESE.test(text) && !KEPT.test(text);
}

type Line = { id: string; role: string; kind: string; text?: string | null; turnId?: string; turnTerminal?: boolean; from?: { botId: string } | null };

const plainWords = (message: object) =>
  Object.entries(message).every(([key, value]) => PLAIN.has(key) || value == null || (Array.isArray(value) && value.length === 0));

/** `messages` without the bots' all-English lines along the way; the same array when none is left out. The `keep` ids
 * always stay. */
export function withoutEnglishSteps<M extends Line>(messages: M[], keep: readonly (string | null | undefined)[] = []): M[] {
  const answered = new Set<string>(), turnEnds = new Map<string, number>(), lastLines = new Map<string, number>();
  messages.forEach((message, index) => {
    if (!message.turnId) return;
    turnEnds.set(message.turnId, index);
    if (message.turnTerminal) answered.add(message.turnId);
    if (message.role !== "user" && message.kind === "text" && message.text) lastLines.set(message.turnId, index);
  });
  const hidden = new Set<string>();
  // Walking back from the newest: the bots that said something later, since the person last spoke.
  const spokeLater = new Set<string>();
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role === "user") {
      spokeLater.clear();
      continue;
    }
    if (message.kind !== "text" || !message.text) continue;
    const speaker = message.from?.botId ?? "", turn = message.turnId;
    const endedUnmarked = turn !== undefined && !answered.has(turn) && turnEnds.get(turn)! < messages.length - 1 && lastLines.get(turn) === index;
    const along = turn ? !message.turnTerminal && !endedUnmarked : spokeLater.has(speaker);
    if (along && !keep.includes(message.id) && plainWords(message) && allEnglish(message.text)) hidden.add(message.id);
    spokeLater.add(speaker);
  }
  return hidden.size ? messages.filter((message) => !hidden.has(message.id)) : messages;
}

let unreadLine: string | null = null;

/** The shell's first unread message (useSuyuan, while it renders): the chat's new-messages line sits above it. */
export function noteUnreadLine(id: string | null): void {
  unreadLine = id;
}

/** The chat's messages as Simple mode shows them, once the app shell says each bot has one conversation; upstream's
 * otherwise, so a test that never mounts the shell sees upstream's chat. */
export function quietChat<M extends Line>(messages: M[], pinned?: string): M[] {
  return oneConversation() ? withoutEnglishSteps(messages, [pinned, unreadLine]) : messages;
}

/** Words still arriving that Simple mode leaves out until their turn ends: a running turn's English. */
export function quietLive(text: string): boolean {
  return oneConversation() && allEnglish(text);
}

/** Whether a transcript window stops at the chat's end as Simple mode shows it: after its last row only lines the chat
 * leaves out, so the words still arriving draw after it (src/state/live-reply.ts). */
export function endsShown(windowed: readonly { id: string }[], transcript: readonly Line[]): boolean {
  const last = windowed.at(-1)?.id;
  if (!oneConversation() || last === undefined) return false;
  const at = transcript.findLastIndex((message) => message.id === last);
  if (at < 0) return false;
  const shown = new Set(withoutEnglishSteps([...transcript]).map((message) => message.id));
  return transcript.slice(at + 1).every((message) => !shown.has(message.id));
}
