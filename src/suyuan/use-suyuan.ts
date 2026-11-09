// suyuan fork: the one hook src/App.tsx's shell calls, so every fork feature that needs the app's state plugs in here.
import { useEffect, useLayoutEffect } from "react";
import { t } from "@/lib/i18n";
import { useRoomPanel } from "@/lib/room-panel";
import { useInboxPanel } from "@/state/inbox";
import type { Action, AppState } from "@/state/store";
import { chatAlone } from "./chat-alone";
import { liftFrame, noteApp, noteAppGone } from "./last-frame";
import "./room-router.css";
import "./steady-tables.css";
import "./no-zoom.css";
import { installNoZoom } from "./no-zoom";
import { hideBackButton, installSwipeBack } from "./swipe-back";
import { useWebPush } from "./use-web-push";
import "./wide-replies.css";

/** Long enough for the live chat to lay out and scroll before the frozen copy over it goes. */
const SETTLE_MS = 150;

export function useSuyuan(state: AppState, dispatch: (action: Action) => void): void {
  useWebPush(state, dispatch);
  const loaded = state.hydrated === true;
  const alone = chatAlone(state, { inboxOpen: useInboxPanel().open, roomOpen: useRoomPanel() !== null });
  // A layout effect runs inside React's commit, before the cover's watcher hears that #root changed.
  useLayoutEffect(() => noteApp(loaded, alone), [loaded, alone]);
  useLayoutEffect(() => noteAppGone, []);
  useEffect(() => installSwipeBack(), []);
  useEffect(() => installNoZoom(), []);
  // Read on every render: the button's name changes when the language pack arrives.
  const backLabel = t("app.openBotList");
  useEffect(() => hideBackButton(backLabel), [backLabel]);
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(liftFrame, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [loaded]);
}
