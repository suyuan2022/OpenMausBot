import { Plus } from "lucide-react";
import { t } from "@/lib/i18n";
import { useStoreDispatch } from "@/state/store-select";
import { oneConversation } from "@/suyuan/home";

export function NewThreadHeaderButton({ botId }: { botId: string }) {
  const dispatch = useStoreDispatch();
  if (oneConversation()) return null; // suyuan fork: one conversation per bot offers no way to start another (src/suyuan/home.ts)
  return (
    <button
      type="button"
      data-new-thread
      onClick={() => dispatch({ type: "newTask", botId })}
      aria-label={t("task.newShort")}
      aria-keyshortcuts="Meta+T Control+T"
      title={t("task.newShort")}
      className="flex size-9 shrink-0 items-center justify-center rounded-full text-ink-secondary transition-colors duration-[120ms] hover:bg-ink/[0.06] hover:text-ink active:bg-ink/[0.08] motion-reduce:transition-none"
    >
      <Plus size={16} aria-hidden="true" />
    </button>
  );
}
