// suyuan fork: the one hook src/App.tsx's shell calls, so every fork feature that needs the app's state plugs in here.
import { useEffect, useLayoutEffect } from "react";
import { useRoomPanel } from "@/lib/room-panel";
import { useInboxPanel } from "@/state/inbox";
import type { Action, AppState } from "@/state/store";
import { chatAlone } from "./chat-alone";
import { liftFrame, noteApp, noteAppGone } from "./last-frame";
import "./steady-tables.css";
import { useWebPush } from "./use-web-push";

/** Long enough for the live chat to lay out and scroll before the frozen copy over it goes. */
const SETTLE_MS = 150;

export function useSuyuan(state: AppState, dispatch: (action: Action) => void): void {
  useWebPush(state, dispatch);
  const loaded = state.hydrated === true;
  const alone = chatAlone(state, { inboxOpen: useInboxPanel().open, roomOpen: useRoomPanel() !== null });
  // A layout effect runs inside React's commit, before the cover's watcher hears that #root changed.
  useLayoutEffect(() => noteApp(loaded, alone), [loaded, alone]);
  useLayoutEffect(() => noteAppGone, []);
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(liftFrame, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [loaded]);
}
