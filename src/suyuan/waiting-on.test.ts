import { afterEach, describe, expect, it } from "vitest";

import { setLocale, t } from "@/lib/i18n";
import type { InboxRow, InboxView } from "../../shared/inbox";
import { inboxCatchUpKey, unreadRows } from "./inbox-unread";
import { noteBotNames, waitingOnLine } from "./waiting-on";

afterEach(() => { setLocale("en"); });

describe("a bot waiting on teammates", () => {
  noteBotNames([{ id: "maus", name: "Maus 工程师" }, { id: "lily", name: "荔枝" }]);

  it("says whose answer it waits for, from its own conversations, each teammate once", () => {
    setLocale("zh-CN");
    expect(waitingOnLine({ waitingForTeammates: true, waitingOn: ["lily"] })).toBe("在等荔枝回话");
    expect(waitingOnLine({ waitingForTeammates: true, waitingOn: ["maus"] })).toBe("在等 Maus 工程师回话");
    expect(waitingOnLine({ tasks: [
      { threadId: "a", waitingForTeammates: true, waitingOn: ["maus", "lily"] },
      { threadId: "b", waitingForTeammates: true, waitingOn: ["lily"] },
      { threadId: "c", waitingForTeammates: false, waitingOn: ["ghost"] },
    ] })).toBe("在等 Maus 工程师、荔枝回话");
    setLocale("en");
    expect(waitingOnLine({ waitingForTeammates: true, waitingOn: ["lily"] })).toBe("Waiting on 荔枝…");
  });

  it("falls back on upstream's words when it does not know who", () => {
    expect(waitingOnLine({ waitingForTeammates: true })).toBe(t("sidebar.preview.waitingOnTeammate"));
    expect(waitingOnLine({ waitingForTeammates: true, waitingOn: ["gone"] })).toBe(t("sidebar.preview.waitingOnTeammate"));
  });
});

describe("the inbox's list", () => {
  const row = (id: string, tab: InboxRow["tab"], unread: boolean, at: number): InboxRow => ({ id, kind: tab === "needs-you" ? "ask" : "result", tab, unread, at, from: { name: "Eli" }, text: id });
  const view: InboxView = { botId: null, threadId: null, anchor: null, rows: [
    row("ask-read", "needs-you", false, 5), row("news-new", "info", true, 4), row("news-read", "info", false, 3), row("settled", "done", false, 2),
  ] };

  it("lists every ask and the news not yet read, newest first", () => {
    expect(unreadRows(view, new Set()).map((one) => one.id)).toEqual(["ask-read", "news-new"]);
  });

  it("keeps a line opened in the panel while it is open, and drops one read elsewhere at once", () => {
    const read = { ...view, rows: view.rows.map((one) => (one.id === "news-new" ? { ...one, unread: false } : one)) };
    expect(unreadRows(read, new Set(["news-new"])).map((one) => one.id)).toEqual(["ask-read", "news-new"]);
    expect(unreadRows(read, new Set()).map((one) => one.id), "the server says it was read in its conversation").toEqual(["ask-read"]);
  });

  it("reads the inbox again when the person moves to another conversation or a bot's unread mark changes", () => {
    const bots = [{ id: "a", threadId: "a1", unread: true }, { id: "b", threadId: "b1" }];
    const before = inboxCatchUpKey({ selectedId: "a", bots });
    expect(inboxCatchUpKey({ selectedId: "a", bots: [...bots] })).toBe(before);
    expect(inboxCatchUpKey({ selectedId: "b", bots })).not.toBe(before);
    expect(inboxCatchUpKey({ selectedId: "a", bots: [{ ...bots[0]!, unread: false }, bots[1]!] })).not.toBe(before);
  });
});
