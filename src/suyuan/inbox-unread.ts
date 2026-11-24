// suyuan fork (FORK.md): the inbox lists what waits on the person and what they have not read. News they have read leaves
// the list, as if marked done: they read it in the inbox, or in the conversation it came from (server/suyuan/inbox-read.ts).
// A line they open in the panel stays listed while the panel is open, so reading one neither pulls it out from under them
// nor breaks stepping to the next; it is gone the next time the inbox opens. Only lines opened here stay: one the server
// says was read elsewhere goes at once, even when the panel first drew it from what it held before.
import { useEffect, useRef } from "react";
import type { InboxRow, InboxView } from "../../shared/inbox";
import { listedRows } from "@/components/inbox/inbox-view";
import { refreshInbox, useInboxPanel, useInboxSupport } from "@/state/inbox";

/** What the list shows: every ask, unread news, and the lines opened in the panel since it opened. */
export function unreadRows(view: InboxView | null, openedHere: ReadonlySet<string>): InboxRow[] {
  return listedRows(view).filter((row) => row.tab === "needs-you" || row.unread || openedHere.has(row.id));
}

/** unreadRows for the open panel: it remembers each line opened in it until it closes. */
export function useUnreadRows(view: InboxView | null): InboxRow[] {
  const opened = useRef(new Set<string>());
  const { reading } = useInboxPanel();
  if (reading) opened.current.add(reading);
  return unreadRows(view, opened.current);
}

/** Reading a conversation can read lines of the inbox that came from its background runs, which nothing else announces:
 * read the inbox again a moment after the person moves to another conversation or a bot's unread mark changes. */
const CATCH_UP_MS = 600;

export function inboxCatchUpKey(state: { selectedId?: string | null; bots: ReadonlyArray<{ id: string; threadId?: string; unread?: boolean }> }): string {
  return `${state.selectedId ?? ""}|${state.bots.map((bot) => `${bot.id}:${bot.threadId ?? ""}:${bot.unread ? 1 : 0}`).join(",")}`;
}

export function useInboxCatchUp(key: string, loaded: boolean): void {
  const support = useInboxSupport();
  const asked = loaded && support === "yes";
  useEffect(() => {
    if (!asked) return;
    const timer = setTimeout(() => void refreshInbox(), CATCH_UP_MS);
    return () => clearTimeout(timer);
  }, [key, asked]);
}
