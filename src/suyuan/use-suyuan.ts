// suyuan fork: the one hook src/App.tsx's shell calls, so every fork feature that needs the app's state plugs in here.
import { useEffect, useLayoutEffect } from "react";
import type { Action, AppState } from "@/state/store";
import { liftFrame, noteApp, noteAppGone } from "./last-frame";
import { useWebPush } from "./use-web-push";

/** Long enough for the live chat to lay out and scroll before the frozen copy over it goes. */
const SETTLE_MS = 150;

export function useSuyuan(state: AppState, dispatch: (action: Action) => void): void {
  useWebPush(state, dispatch);
  const loaded = state.hydrated === true;
  // The app reopens on the chat with these panels closed; only a pinned notification tray comes back open.
  const chatAlone = state.activeView === "chat" && !state.settingsOpen && !state.computerOpen && !state.inspectorOpen
    && !state.activityOpen && (!state.notificationsOpen || state.notificationsPinned);
  // A layout effect runs inside React's commit, before the cover's watcher hears that #root changed.
  useLayoutEffect(() => noteApp(loaded, chatAlone), [loaded, chatAlone]);
  useLayoutEffect(() => noteAppGone, []);
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(liftFrame, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [loaded]);
}
