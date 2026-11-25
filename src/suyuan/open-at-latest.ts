// suyuan fork: a conversation opens at its newest message every time. Upstream reopens a conversation where the reader
// left it (src/hooks/use-transcript-viewport.ts); he read that as the app not taking him to the latest: 「有的时候不直接给我
// 回到最下面一条，而是直接打开…往上翻才能看到的那条。这逻辑不对啊」. Within one visit nothing changes: scrolling up, opening the
// list and closing it again keep the place.
import { rememberTranscriptPosition } from "@/lib/transcript-follow";
import { newChatThreadId } from "@/state/new-chat";
import type { AppState } from "@/state/store";

type Shown = Pick<AppState, "activeView" | "selectedId" | "bots" | "groups" | "newChat">;

/** The chat the shell shows, as src/App.tsx picks it: the selected room, else the selected bot or the first one, drawn
 * under a blank new chat's own id while one is open for it (newChatBot, src/state/new-chat.ts). */
export function shownChat(state: Shown): { ownerId: string; threadId: string } | null {
  if (state.activeView !== "chat") return null;
  const group = state.groups.find((candidate) => candidate.id === state.selectedId);
  if (group) return { ownerId: group.id, threadId: group.threadId };
  const bot = state.bots.find((candidate) => candidate.id === state.selectedId) ?? state.bots[0];
  return bot ? { ownerId: bot.id, threadId: state.newChat?.botId === bot.id ? newChatThreadId(bot.id) : bot.threadId } : null;
}

let last: string | null = null;

/** Called while the shell renders, before the chat under it renders and reads where to open. The transcript's key is
 * `owner:thread`, as use-transcript-viewport.ts builds it. */
export function openAtLatest(chat: { ownerId: string; threadId: string } | null): void {
  const key = chat ? `${chat.ownerId}:${chat.threadId}` : null;
  if (key === last) return;
  last = key;
  if (key) rememberTranscriptPosition(key, { atEnd: true });
}

/** Tests only. */
export function forgetShownChat(): void {
  last = null;
}
