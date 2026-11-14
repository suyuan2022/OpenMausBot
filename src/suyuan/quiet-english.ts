// suyuan fork (FORK.md): in Simple mode a line the bot says along the way that is all English (no Chinese character, some
// Latin letters) is left out of the chat: 夙愿 reads Chinese, and a "Checking the file now." between steps tells him
// nothing. The turn's last line always shows, whatever its language, so no answer is lost; while the turn runs its newest
// line counts as along the way, and shows if the turn ends on it.
import { oneConversation } from "./home";

const CHINESE = /[㐀-鿿豈-﫿　-〿＀-￯]/;
const LATIN = /[A-Za-z]/;

export function allEnglish(text: string): boolean {
  return LATIN.test(text) && !CHINESE.test(text);
}

type Line = { id: string; role: string; kind: string; text?: string | null };

/** `messages` without the bot's all-English lines along the way; the same array when none is left out. `running`: the
 * newest turn is still going. */
export function withoutEnglishSteps<M extends Line>(messages: M[], running: boolean): M[] {
  const hidden = new Set<string>();
  // Walking back from the newest: a bot line with a later bot line in its turn was said along the way.
  let laterLine = running;
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

/** The chat's messages as Simple mode shows them: the same array in Advanced mode, and until the app shell says the thread
 * list is hidden (./home.ts), so a test that never mounts the shell sees upstream's chat. */
export function quietChat<M extends Line>(messages: M[], advanced: boolean, running: boolean): M[] {
  return advanced || !oneConversation() ? messages : withoutEnglishSteps(messages, running);
}
