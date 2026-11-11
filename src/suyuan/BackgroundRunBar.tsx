// suyuan fork: in place of the composer while the person reads a background run (src/suyuan/home.ts): what this thread is,
// and the way back to the one conversation they have with this bot. Cards that wait on them stay answerable above it.
import { Eye } from "lucide-react";

import { t } from "@/lib/i18n";

export function BackgroundRunBar({ onHome }: { onHome: () => void }) {
  return (
    <div className="pointer-events-auto mx-5 mb-4 flex items-center gap-3 rounded-2xl border border-hairline/60 bg-raised px-4 py-3" data-testid="background-run-bar">
      <Eye size={16} aria-hidden="true" className="shrink-0 text-ink-secondary" />
      <p className="min-w-0 flex-1 text-[13px] text-ink-secondary">后台对话，只能看</p>
      <button type="button" onClick={onHome} className="shrink-0 rounded-full bg-accent px-3 py-1 text-[13px] font-medium text-white">
        {t("chat.backToMainThread")}
      </button>
    </div>
  );
}
