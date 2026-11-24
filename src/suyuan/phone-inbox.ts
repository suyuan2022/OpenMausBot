// suyuan fork (FORK.md): on a phone the inbox is a page over the whole screen, opened from the bot list without closing
// it, so closing the inbox lands back on the list. Only going from the inbox into a conversation closes both: the inbox,
// and the bot list under it. The list is src/App.tsx's drawer (src/hooks/use-bot-list-drawer.ts), which closes by itself
// only when the conversation on screen changes; a line that opens the conversation already on screen changes nothing, so
// the inbox asks for it by name.
import { useEffect } from "react";
import { closeInbox } from "@/state/inbox";

export const CLOSE_BOT_DRAWER_EVENT = "suyuan:close-bot-drawer";

/** Asks the app to close the bot list that covers a phone's screen. */
export function closeBotDrawer(): void {
  window.dispatchEvent(new Event(CLOSE_BOT_DRAWER_EVENT));
}

/** The person went from the phone's inbox into a conversation: the inbox and the bot list under it both close. */
export function leavePhoneInbox(): void {
  closeInbox();
  closeBotDrawer();
}

/** The app's half: closes its bot list when asked. */
export function useCloseBotDrawer(hide: () => void): void {
  useEffect(() => {
    window.addEventListener(CLOSE_BOT_DRAWER_EVENT, hide);
    return () => window.removeEventListener(CLOSE_BOT_DRAWER_EVENT, hide);
  }, [hide]);
}
