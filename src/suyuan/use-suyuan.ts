// suyuan fork: the one hook src/App.tsx's shell calls, so thin-fork features plug into one place.
import { useEffect } from "react";
import { t } from "@/lib/i18n";
import { useShowThreads } from "@/lib/thread-preferences";
import type { Action, AppState } from "@/state/store";
import { noteThreadsShown } from "./home";
import { inboxCatchUpKey, useInboxCatchUp } from "./inbox-unread";
import "./chat-wrap.css";
import "./keyboard-fit.css";
import { installKeyboardFit } from "./keyboard-fit";
import "./no-zoom.css";
import { installNoZoom } from "./no-zoom";
import "./phone-code.css";
import "./phone-tables.css";
import { installPreviewZoom } from "./preview-zoom";
import "./skill-burger.css";
import "./steady-tables.css";
import { hideBackButton, installSwipeBack } from "./swipe-back";
import { installTablePlate } from "./table-plate";
import { useWebPush } from "./use-web-push";
import "./wide-replies.css";

export function useSuyuan(state: AppState, dispatch: (action: Action) => void): void {
  // During render, not in an effect: the sidebar, menus and chat render right after and read it (./home.ts).
  noteThreadsShown(useShowThreads());
  useWebPush(state, dispatch);
  useInboxCatchUp(inboxCatchUpKey(state), state.hydrated === true);
  useEffect(() => installSwipeBack(), []);
  useEffect(() => installNoZoom(), []);
  useEffect(() => installKeyboardFit(), []);
  useEffect(() => installPreviewZoom(), []);
  useEffect(() => installTablePlate(), []);
  const backLabel = t("app.openBotList");
  useEffect(() => hideBackButton(backLabel), [backLabel]);
}
