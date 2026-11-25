// suyuan fork: whether the app shows what it reopens on, which is all the last-screen cover (last-frame.ts) may show.
import type { AppState } from "@/state/store";

type Panels = Pick<AppState, "activeView" | "settingsOpen" | "computerOpen" | "inspectorOpen" | "activityOpen" | "notificationsOpen" | "newChat">;

/** The chat with no side panel beside it. A reopen starts every panel here closed: the notification tray too, whose pin
 * alone is remembered, and the inbox and room panels, which live outside AppState (src/state/inbox.ts,
 * src/lib/room-panel.ts). A blank new chat is not kept either (src/state/new-chat.ts): a reopen is back on the bot's
 * conversation. */
export function chatAlone(state: Panels, outside: { inboxOpen: boolean; roomOpen: boolean }): boolean {
  return state.activeView === "chat" && !state.settingsOpen && !state.computerOpen && !state.inspectorOpen
    && !state.activityOpen && !state.notificationsOpen && !state.newChat && !outside.inboxOpen && !outside.roomOpen;
}
