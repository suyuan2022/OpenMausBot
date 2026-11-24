// suyuan fork: what the inbox lists (./inbox-unread.ts).
import { describe, expect, it } from "vitest";
import type { InboxRow, InboxView } from "../../shared/inbox";
import { inboxCatchUpKey, unreadRows } from "./inbox-unread";

const row = (id: string, patch: Partial<InboxRow>): InboxRow => ({ id, kind: "message", tab: "info", unread: false, at: 0, from: { name: "Maus", botId: "maus" }, text: id, ...patch });
const view = (rows: InboxRow[]): InboxView => ({ botId: null, threadId: null, rows, anchor: null });
const ids = (rows: InboxRow[]) => rows.map((one) => one.id);
const none: ReadonlySet<string> = new Set();

describe("what the inbox lists", () => {
  const rows = [
    row("ask-read", { kind: "ask", tab: "needs-you", at: 5 }),
    row("ask-unread", { kind: "ask", tab: "needs-you", unread: true, at: 4 }),
    row("news-unread", { unread: true, at: 3 }),
    row("news-read", { at: 2 }),
    row("result-read", { kind: "result", at: 1 }),
    row("settled", { kind: "ask", tab: "done", at: 9 }),
  ];

  it("lists every ask and the unread news, newest first; news already read and settled lines are not listed", () => {
    expect(ids(unreadRows(view(rows), none))).toEqual(["ask-read", "ask-unread", "news-unread"]);
  });

  it("keeps a line opened in the panel after it is read, and still not a settled one", () => {
    expect(ids(unreadRows(view(rows), new Set(["news-read", "settled"])))).toEqual(["ask-read", "ask-unread", "news-unread", "news-read"]);
  });

  it("drops a line the moment it is read elsewhere, and lists nothing before the inbox has loaded", () => {
    const read = rows.map((one) => (one.id === "news-unread" ? { ...one, unread: false } : one));
    expect(ids(unreadRows(view(read), none))).toEqual(["ask-read", "ask-unread"]);
    expect(unreadRows(null, new Set(["news-read"]))).toEqual([]);
  });
});

describe("when the inbox is read again", () => {
  const bots = [{ id: "maus", threadId: "maus-home", unread: true }, { id: "lily", threadId: "lily-home" }];
  const key = inboxCatchUpKey({ selectedId: "maus", bots });

  it("changes when the person moves to another conversation, a bot's thread changes, or a bot's unread mark changes", () => {
    expect(inboxCatchUpKey({ selectedId: "lily", bots })).not.toBe(key);
    expect(inboxCatchUpKey({ selectedId: "maus", bots: [{ ...bots[0]!, threadId: "maus-work" }, bots[1]!] })).not.toBe(key);
    expect(inboxCatchUpKey({ selectedId: "maus", bots: [{ ...bots[0]!, unread: false }, bots[1]!] })).not.toBe(key);
  });

  it("stays the same when nothing it watches changed", () => {
    expect(inboxCatchUpKey({ selectedId: "maus", bots: bots.map((bot) => ({ ...bot, name: "renamed" })) })).toBe(key);
    expect(inboxCatchUpKey({ bots: [] })).toBe("|");
  });
});
