// suyuan fork (FORK.md): the inbox lists what waits on the person and what they have not read. News they have read leaves
// the list, as if marked done: they read it in the inbox, or in the conversation it came from (server/suyuan/inbox-read.ts).
// While the panel stays open a line read in it stays listed, so reading one neither pulls it out from under them nor
// breaks stepping to the next; it is gone the next time the inbox opens.
import { useRef } from "react";
import type { InboxRow, InboxView } from "../../shared/inbox";
import { listedRows } from "@/components/inbox/inbox-view";

/** What the list shows: every ask, unread news, and the lines it already showed since the panel opened. */
export function unreadRows(view: InboxView | null, shown: ReadonlySet<string>): InboxRow[] {
  return listedRows(view).filter((row) => row.tab === "needs-you" || row.unread || shown.has(row.id));
}

/** unreadRows for the open panel: it remembers what it listed until it closes. */
export function useUnreadRows(view: InboxView | null): InboxRow[] {
  const shown = useRef(new Set<string>());
  const rows = unreadRows(view, shown.current);
  for (const row of rows) shown.current.add(row.id);
  return rows;
}
