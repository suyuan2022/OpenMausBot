// suyuan fork: a notification tapped while the app was closed opens a fresh page on ?pushBot=&pushThread=
// (public/suyuan-push-sw.js). The app reopens on the last conversation and only switches once the bots have loaded
// (./use-web-push.ts), so the chat he had left showed first and the notification's chat came a beat later. Taking the
// notification's bot as the last conversation before the app's script runs makes the first snapshot carry that bot's
// whole page (src/state/chat-snapshot.ts) and the app open on it.
import { rememberConversation } from "@/lib/last-conversation";

export interface PushTarget {
  botId: string;
  threadId: string;
}

let openedOnPush = false;

export function pushTarget(search: string): PushTarget | null {
  const params = new URLSearchParams(search);
  const botId = params.get("pushBot"), threadId = params.get("pushThread");
  return botId && threadId ? { botId, threadId } : null;
}

/** A room's notification names the bot that spoke with the room's thread: the app opens on that bot, and the switch to the
 * room (./use-web-push.ts) lands before the first paint. */
export function resumeOnPushTarget(search: string): void {
  const target = pushTarget(search);
  if (!target) return;
  openedOnPush = true;
  rememberConversation(target.botId);
}

/** The page opened from a notification, which decides where the app opens (./use-web-push.ts). The start's own return to
 * the bot's main conversation (src/state/store.tsx) stands aside: it runs after the notification's switch and, with the
 * bot left on another of its threads, took the app back to the main one. */
export function openingOnPush(): boolean {
  return openedOnPush;
}
