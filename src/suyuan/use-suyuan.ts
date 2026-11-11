// suyuan fork: the one hook src/App.tsx's shell calls, so every fork feature that needs the app's state plugs in here.
import { useEffect, useLayoutEffect } from "react";
import { t } from "@/lib/i18n";
import { useRoomPanel } from "@/lib/room-panel";
import { useShowThreads } from "@/lib/thread-preferences";
import { useInboxPanel } from "@/state/inbox";
import type { Action, AppState } from "@/state/store";
import { chatAlone } from "./chat-alone";
import { noteThreadsShown } from "./home";
import { liftFrame, noteApp, noteAppGone } from "./last-frame";
import "./phone-code.css";
import "./phone-tables.css";
import "./phone-tiles.css";
import "./room-router.css";
import "./phone-header.css";
import "./steady-tables.css";
import "./no-zoom.css";
import { installNoZoom } from "./no-zoom";
import { installPreviewZoom } from "./preview-zoom";
import { hideBackButton, installSwipeBack } from "./swipe-back";
import { installTrayAtFinger } from "./tray-at-finger";
import { installTablePlate } from "./table-plate";
import { installTileMenu } from "./tile-menu";
import { useWebPush } from "./use-web-push";
import "./wide-replies.css";

/** Long enough for the live chat to lay out and scroll before the frozen copy over it goes. */
const SETTLE_MS = 150;

export function useSuyuan(state: AppState, dispatch: (action: Action) => void): void {
  // During render, not in an effect: the sidebar and the chat render right after and read it (./home.ts).
  noteThreadsShown(useShowThreads());
  useWebPush(state, dispatch);
  const loaded = state.hydrated === true;
  const alone = chatAlone(state, { inboxOpen: useInboxPanel().open, roomOpen: useRoomPanel() !== null });
  // A layout effect runs inside React's commit, before the cover's watcher hears that #root changed.
  useLayoutEffect(() => noteApp(loaded, alone), [loaded, alone]);
  useLayoutEffect(() => noteAppGone, []);
  useEffect(() => installSwipeBack(), []);
  useEffect(() => installTrayAtFinger(), []);
  useEffect(() => installNoZoom(), []);
  useEffect(() => installPreviewZoom(), []);
  useEffect(() => installTablePlate(), []);
  useEffect(() => installTileMenu(), []);
  // Read on every render: the button's name changes when the language pack arrives.
  const backLabel = t("app.openBotList");
  useEffect(() => hideBackButton(backLabel), [backLabel]);
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(liftFrame, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [loaded]);
}
