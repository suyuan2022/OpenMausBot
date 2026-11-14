// suyuan fork: the head of the chat header pill on a run another bot passed on, "荔枝 →" before this bot's face and name
// (src/suyuan/relay.ts). Nothing on any other thread. The run keeps the name the bot had when it passed the work on; the
// bot's name now wins while it is still here. A short name keeps its room on a phone; the thread's title gives way first.
import { ArrowRight } from "lucide-react";

import { useStore } from "@/state/store";
import type { PassedOn } from "./relay";

export function PassedOnFrom({ passed }: { passed: PassedOn | null }) {
  const { state } = useStore();
  if (!passed) return null;
  const name = state.bots.find((candidate) => candidate.id === passed.botId)?.name || passed.name;
  return (
    <span data-chathead-passed-from className="ml-1.5 flex max-w-[7em] shrink-0 items-center gap-1 text-[14px] font-medium leading-5 text-ink-secondary">
      <span dir="auto" className="min-w-0 truncate">{name}</span>
      <ArrowRight size={13} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
    </span>
  );
}
