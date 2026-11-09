// suyuan fork: on a phone the Inbox is a round button left of the top right +, in place of the full-width row under the
// profile picture (src/components/SidebarInboxRow.tsx), which pushed the bot list a row down. While anything waits on
// the person it wears a red dot, with no count: the Inbox itself says what waits.
import { Inbox } from "lucide-react";
import { inboxFixes, waitingCount } from "@/components/inbox/inbox-view";
import { PHONE_TOP_BUTTON } from "@/components/SidebarSimpleTop";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { closeInbox, openInbox, useInboxPanel, useInboxSupport, useInboxView } from "@/state/inbox";
import { useTeamPeople } from "@/state/team-people";

export function PhoneInboxButton({ onOpened }: { onOpened?: () => void }) {
  const support = useInboxSupport();
  const view = useInboxView();
  const team = useTeamPeople();
  const { open } = useInboxPanel();
  if (support === "no") return null;
  const count = waitingCount(view) + inboxFixes(team?.needsYou, view).length;
  const label = count > 0 ? t("inbox.row.count", { count }) : t("inbox.panel.title");
  const toggle = () => {
    if (open) closeInbox();
    else { openInbox(); onOpened?.(); }
  };
  return (
    <button type="button" data-sidebar-inbox={count} aria-label={label} title={label} aria-pressed={open} onClick={toggle}
      className={cn(PHONE_TOP_BUTTON, "relative me-1")}>
      <Inbox size={20} strokeWidth={1.75} aria-hidden="true" />
      {count > 0 && <span aria-hidden="true" data-inbox-dot className="absolute right-0.5 top-0.5 size-2.5 rounded-full bg-danger ring-2 ring-app" />}
    </button>
  );
}
