// suyuan fork: a one-way notice may go into any live thread the sender may reach, whoever opened it; new work may not.
import { describe, expect, it } from "vitest";

import type { TaskRecord } from "../store.ts";
import { OUTSIDE_STAYS_HERE } from "./outside-lineage.ts";
import { workThreadFor } from "./work-thread.ts";

const by = (botId: string, name: string, threadId: string, more: Partial<NonNullable<TaskRecord["openedBy"]>> = {}): TaskRecord["openedBy"] => ({ botId, name, threadId, kind: "work", at: 0, ...more });
const task = (threadId: string, openedBy?: TaskRecord["openedBy"], more: Partial<TaskRecord> = {}): TaskRecord =>
  ({ id: threadId, threadId, title: threadId, ...(openedBy ? { openedBy } : {}), ...more }) as TaskRecord;

// Maus's threads: one a person opened, one the Scout bot opened, one Chief opened itself, one archived, one a room lane.
const tasks = [
  task("by-person"), task("by-scout", by("scout", "Scout", "scout-chat")), task("by-chief", by("chief", "Chief", "chief-chat")),
  task("archived", by("scout", "Scout", "scout-chat"), { archivedAt: 1 }), task("lane", by("scout", "Scout", "room", { roomLane: true } as never)),
];
const store = { taskByThread: (_bot: string, threadId: string) => tasks.find((t) => t.threadId === threadId), workThread: () => undefined };
const fromChief = (thread: string, notice: boolean, reach: (task: TaskRecord) => boolean = () => true) => workThreadFor(store,
  { botId: "maus", botName: "Maus", fromBotId: "chief", fromThreadId: "chief-chat", thread, notice, answering: undefined, also: () => true, reach });

describe("workThreadFor, notices into threads someone else opened", () => {
  it("takes a one-way notice into a thread a person or another bot opened, and leaves who opened it alone", () => {
    for (const thread of ["by-person", "by-scout"]) {
      const found = fromChief(thread, true);
      expect(found?.threadId).toBe(thread);
      expect(found?.openedBy?.botId).not.toBe("chief");
    }
    expect(fromChief("by-scout", true)?.openedBy).toEqual(tasks[1]!.openedBy);
  });

  it("refuses new work there and says to use standing or new", () => {
    for (const thread of ["by-person", "by-scout"]) {
      expect(() => fromChief(thread, false)).toThrow(/only a one-way notice.*"standing" or "new"/);
    }
  });

  it("still refuses an archived thread, a room lane, and a thread outside its reach", () => {
    expect(() => fromChief("archived", true)).toThrow(/is not a thread you opened/);
    expect(() => fromChief("lane", true)).toThrow(/is not a thread you opened|opened by someone else/);
    expect(() => fromChief("by-person", true, () => false)).toThrow(OUTSIDE_STAYS_HERE);
    expect(() => fromChief("by-person", false, () => false)).toThrow(OUTSIDE_STAYS_HERE);
  });

  it("keeps a thread the sender opened working for both kinds of send", () => {
    expect(fromChief("by-chief", false)?.threadId).toBe("by-chief");
    expect(fromChief("by-chief", true)?.threadId).toBe("by-chief");
  });
});
