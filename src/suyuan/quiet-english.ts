// suyuan fork: with one conversation per bot (./home.ts), a line a bot says along the way that is all English (Latin
// letters, no Chinese) is left out of the chat, a bot's and a room's alike. 夙愿 reads Chinese, and a "Checking the file
// now." between steps tells him nothing; he kept this filter on 11-15 (FORK.md), and the 11-24 rebuild dropped it by
// mistake. Ported from the v1 fork (PR #53).
//
// A turn's answer always shows, whatever its language: the server marks it (`turnTerminal`) as the turn ends, a change to
// the messages the chat's list is memoized on (src/components/ChatView.tsx), so the answer shows the moment its turn
// ends. Until then the turn's English lines stay out, rather than show and vanish when the next one comes; the working
// dots (./quiet-status.css) say the bot is at it. A line with no turn keeps v1's rule: out once its bot has said something
// after it, before the person speaks again. A line that carries more than words stays: attachments, the pinned message,
// a link, a table, a code block or math.
import { oneConversation } from "./home";

const CHINESE = /[㐀-鿿豈-﫿　-〿＀-￯]/;
const LATIN = /[A-Za-z]/;
/** A web or Markdown link, a code block, a table row, display math. */
const KEPT = /https?:\/\/|\]\(|```|^\s*\|.*\|\s*$|\$\$|\\\[/m;

export function allEnglish(text: string): boolean {
  return LATIN.test(text) && !CHINESE.test(text) && !KEPT.test(text);
}

type Line = {
  id: string; role: string; kind: string; text?: string | null;
  attachments?: readonly unknown[] | null; turnId?: string; turnTerminal?: boolean; from?: { botId: string } | null;
};

/** `messages` without the bots' all-English lines along the way; the same array when none is left out. `keep` (the
 * pinned message) always stays. */
export function withoutEnglishSteps<M extends Line>(messages: M[], keep?: string): M[] {
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
    const speaker = message.from?.botId ?? "";
    const along = message.turnId ? !message.turnTerminal : spokeLater.has(speaker);
    if (along && message.id !== keep && !message.attachments?.length && allEnglish(message.text)) hidden.add(message.id);
    spokeLater.add(speaker);
  }
  return hidden.size ? messages.filter((message) => !hidden.has(message.id)) : messages;
}

/** The chat's messages as Simple mode shows them, once the app shell says each bot has one conversation; upstream's
 * otherwise, so a test that never mounts the shell sees upstream's chat. */
export function quietChat<M extends Line>(messages: M[], keep?: string): M[] {
  return oneConversation() ? withoutEnglishSteps(messages, keep) : messages;
}
