// suyuan fork: in place of the composer while the person reads a background run (src/suyuan/home.ts): what this thread is,
// and 返回, which Esc presses too: back to the bot that passed this run on, else to the one conversation they have with
// this bot (src/suyuan/relay.ts). Cards that wait on them stay answerable above it.
import { Eye } from "lucide-react";
import { useEffect, useRef } from "react";

import { useStore, type Bot } from "@/state/store";
import { escapeGoesBack, goBack } from "./relay";

export function BackgroundRunBar({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const back = useRef(() => {});
  back.current = () => goBack(dispatch, bot, state.bots);
  const panelOpen = state.settingsOpen;
  useEffect(() => {
    if (panelOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (!escapeGoesBack(event)) return;
      // Whatever else answers this Escape (a popover closing, the find bar) marks it handled; then it is not 返回.
      setTimeout(() => {
        if (!event.defaultPrevented) back.current();
      }, 0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen]);
  return (
    <div className="pointer-events-auto mx-5 mb-4 flex items-center gap-3 rounded-2xl border border-hairline/60 bg-raised px-4 py-3" data-testid="background-run-bar">
      <Eye size={16} aria-hidden="true" className="shrink-0 text-ink-secondary" />
      <p className="min-w-0 flex-1 text-[13px] text-ink-secondary">后台对话，只能看</p>
      <button type="button" onClick={() => back.current()} className="shrink-0 rounded-full bg-accent px-3 py-1 text-[13px] font-medium text-white">
        返回
      </button>
    </div>
  );
}
