// suyuan fork: with one conversation per bot (./home.ts), a line the bot says along the way that is all English (Latin
// letters, no Chinese) is left out of the chat. 夙愿 reads Chinese, and a "Checking the file now." between steps tells him
// nothing; he kept this filter on 11-15 (FORK.md), and the 11-24 rebuild dropped it by mistake. The newest line of a turn
// always shows, whatever its language, so no answer is lost; a line with a link or a code block shows too. Ported from the
// v1 fork (PR #53), without its "turn still running" input: the chat's list is memoized on its messages alone
// (src/components/ChatView.tsx), so a turn's last line never waits on a flag that changes without them.
import { oneConversation } from "./home";

const CHINESE = /[㐀-鿿豈-﫿　-〿＀-￯]/;
const LATIN = /[A-Za-z]/;
const KEPT = /https?:\/\/|```/;

export function allEnglish(text: string): boolean {
  return LATIN.test(text) && !CHINESE.test(text) && !KEPT.test(text);
}

type Line = { id: string; role: string; kind: string; text?: string | null };

/** `messages` without the bot's all-English lines that have a later bot line in their turn; the same array when none is
 * left out. */
export function withoutEnglishSteps<M extends Line>(messages: M[]): M[] {
  const hidden = new Set<string>();
  // Walking back from the newest: a bot line with a later bot line in its turn was said along the way.
  let laterLine = false;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role === "user") {
      laterLine = false;
      continue;
    }
    if (message.kind !== "text" || !message.text) continue;
    if (laterLine && allEnglish(message.text)) hidden.add(message.id);
    laterLine = true;
  }
  return hidden.size ? messages.filter((message) => !hidden.has(message.id)) : messages;
}

/** The chat's messages as Simple mode shows them, once the app shell says each bot has one conversation; upstream's
 * otherwise, so a test that never mounts the shell sees upstream's chat. */
export function quietChat<M extends Line>(messages: M[]): M[] {
  return oneConversation() ? withoutEnglishSteps(messages) : messages;
}
