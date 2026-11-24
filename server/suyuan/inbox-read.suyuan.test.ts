import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { RequestAuth } from "../request-auth.ts";
import { createPlaceInbox, type PlaceInboxDeps } from "../host/place-inbox.ts";
import { readsWith, reportsTo } from "./inbox-read.ts";

type Task = { threadId: string; createdAt: number; routineRunId?: string; openedBy?: { threadId?: string } };

// Lily is the Chief; she handed work to Maus, whose thread opened one on Scout. Maus also has a scheduled run.
const bots: Record<string, { id: string; threadId: string; tasks: Task[] }> = {
  lily: { id: "lily", threadId: "lily-home", tasks: [{ threadId: "lily-home", createdAt: 1 }] },
  maus: { id: "maus", threadId: "maus-home", tasks: [
    { threadId: "maus-home", createdAt: 1 },
    { threadId: "maus-work", createdAt: 2, openedBy: { threadId: "lily-home" } },
    { threadId: "maus-run", createdAt: 3, routineRunId: "run-1" },
    { threadId: "maus-loop", createdAt: 4, openedBy: { threadId: "scout-loop" } },
  ] },
  scout: { id: "scout", threadId: "scout-home", tasks: [
    { threadId: "scout-home", createdAt: 1 },
    { threadId: "scout-work", createdAt: 2, openedBy: { threadId: "maus-work" } },
    { threadId: "scout-loop", createdAt: 3, openedBy: { threadId: "maus-loop" } },
  ] },
};
const store = {
  botByThread: (threadId: string) => Object.values(bots).find((bot) => bot.tasks.some((task) => task.threadId === threadId)),
  bot: (botId: string) => bots[botId],
  tasks: (botId: string) => bots[botId]?.tasks ?? [],
};
const noLive = () => null;

describe("a background run is read with the conversation it reports to", () => {
  it("handed work reports to the thread that opened it, a scheduled run to its bot's home, a home to nothing", () => {
    expect(reportsTo(store, "maus-work", noLive)).toBe("lily-home");
    expect(reportsTo(store, "maus-run", noLive)).toBe("maus-home");
    expect(reportsTo(store, "maus-home", noLive)).toBeNull();
    expect(reportsTo(store, "nowhere", noLive)).toBeNull();
  });

  it("a live handoff names the thread waiting on it before the thread that first opened the run", () => {
    expect(reportsTo(store, "maus-work", (id) => (id === "maus-work" ? "lily-other" : null))).toBe("lily-other");
  });

  it("reading a conversation reads runs reporting to it however deep, and nothing else", () => {
    expect(readsWith(store, "scout-work", "lily-home", noLive)).toBe(true);
    expect(readsWith(store, "scout-work", "maus-work", noLive)).toBe(true);
    expect(readsWith(store, "maus-run", "maus-home", noLive)).toBe(true);
    expect(readsWith(store, "lily-home", "lily-home", noLive)).toBe(true);
    expect(readsWith(store, "maus-run", "lily-home", noLive)).toBe(false);
    expect(readsWith(store, "scout-work", "scout-home", noLive)).toBe(false);
    expect(readsWith(store, "maus-loop", "lily-home", noLive), "a loop in the openers stops").toBe(false);
  });
});

describe("the inbox off a team", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
  const OWNER = { kind: "owner-session" } as unknown as RequestAuth;

  it("marks a line from handed work read when the person reads the conversation that handed it, not before", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "inbox-read-"));
    dirs.push(dataDir);
    const named = { id: "maus", name: "Maus", threadId: "maus-home", color: "blue", notifications: false };
    const inbox = createPlaceInbox({
      dataDir,
      store: {
        bot: () => named, botByThread: () => named, taskByThread: (_bot: string, threadId: string) => ({ threadId, title: threadId }),
        groupByThread: () => undefined, appendMessage: (_threadId: string, line: object) => ({ ...line, id: "m1", at: 1 }),
        patchTask: () => undefined, patchGroup: () => undefined, messagesFor: () => [], onChange: () => () => undefined,
      } as unknown as PlaceInboxDeps["store"],
      openCards: () => [], live: () => false, viewer: () => ({ kind: "owner" }), sees: () => true, mayAnswer: () => true,
      guestOf: () => null, guestName: () => undefined, handedBy: () => null, send: () => undefined,
      readsWith: (lineThread, opened) => readsWith(store, lineThread, opened, noLive),
    });
    inbox.message("maus", "maus-work", "45 is not on yet.");
    const unread = () => inbox.view(OWNER).rows.map((row) => row.unread);
    expect(unread()).toEqual([true]);
    inbox.seen(OWNER, "scout-home");
    expect(unread(), "another conversation reads nothing").toEqual([true]);
    inbox.seen(OWNER, "lily-home");
    expect(unread()).toEqual([false]);
    expect(inbox.count(OWNER)).toBe(0);
  });
});
