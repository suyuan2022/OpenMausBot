// suyuan fork: the one hook src/App.tsx's shell calls, so thin-fork features plug into one place.
import { useEffect, useLayoutEffect } from "react";
import { t } from "@/lib/i18n";
import { useRoomPanel } from "@/lib/room-panel";
import { useShowThreads } from "@/lib/thread-preferences";
import { PHONE_LAYOUT, useMediaQuery } from "@/lib/use-media-query";
import { useInboxPanel } from "@/state/inbox";
import type { Action, AppState } from "@/state/store";
import { chatAlone } from "./chat-alone";
import { notePhoneHome } from "./hero-pins";
import { noteHomes, noteThreadsShown } from "./home";
import { inboxCatchUpKey, useInboxCatchUp } from "./inbox-unread";
import { liftFrame, noteApp, noteAppGone } from "./last-frame";
import { openAtLatest, shownChat } from "./open-at-latest";
import { noteUnreadLine } from "./quiet-english";
import "./chat-wrap.css";
import "./keyboard-fit.css";
import { installKeyboardFit } from "./keyboard-fit";
import "./no-clutter.css";
import "./no-zoom.css";
import { installNoZoom } from "./no-zoom";
import "./phone-code.css";
import "./phone-tables.css";
import "./quiet-rows.css";
import "./quiet-status.css";
import { installPreviewZoom } from "./preview-zoom";
import "./skill-burger.css";
import { installSteadyImages } from "./steady-images";
import "./steady-tables.css";
import { hideBackButton, installSwipeBack } from "./swipe-back";
import { installTablePlate } from "./table-plate";
import { installTileMenu } from "./tile-menu";
import { useWebPush } from "./use-web-push";
import "./wide-replies.css";

/** Long enough for the live chat to lay out and scroll before the frozen copy over it goes (./last-frame.ts). */
const SETTLE_MS = 150;

export function useSuyuan(state: AppState, dispatch: (action: Action) => void): void {
  // During render, not in an effect: the sidebar, menus and chat render right after and read it (./home.ts).
  noteThreadsShown(useShowThreads());
  noteHomes(state.bots);
  notePhoneHome(useMediaQuery(PHONE_LAYOUT, false));
  const shown = shownChat(state);
  openAtLatest(shown);
  noteUnreadLine(state.unreadDivider?.messageId ?? null);
  useWebPush(state, dispatch);
  const loaded = state.hydrated === true;
  useInboxCatchUp(inboxCatchUpKey(state), loaded);
  const alone = chatAlone(state, { inboxOpen: useInboxPanel().open, roomOpen: useRoomPanel() !== null });
  // A layout effect runs inside React's commit, before the cover's watcher hears that #root changed.
  const thread = shown?.threadId ?? null;
  useLayoutEffect(() => noteApp(loaded, alone, thread), [loaded, alone, thread]);
  useLayoutEffect(() => noteAppGone, []);
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(liftFrame, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [loaded]);
  useEffect(() => installSwipeBack(), []);
  useEffect(() => installNoZoom(), []);
  useEffect(() => installKeyboardFit(), []);
  useEffect(() => installPreviewZoom(), []);
  useEffect(() => installTablePlate(), []);
  useEffect(() => installTileMenu(), []);
  useEffect(() => installSteadyImages(), []);
  const backLabel = t("app.openBotList");
  useEffect(() => hideBackButton(backLabel), [backLabel]);
}
