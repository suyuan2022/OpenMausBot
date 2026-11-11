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
const NOT_OPENED = /is not a thread you opened on Maus/;
const fromChief = (thread: string, notice: boolean, others: ((task: TaskRecord) => boolean) | null = () => true, reach: (task: TaskRecord) => boolean = () => true) => workThreadFor(store,
  { botId: "maus", botName: "Maus", fromBotId: "chief", fromThreadId: "chief-chat", thread, notice, answering: undefined, also: () => true, reach, ...(others ? { others } : {}) });

describe("workThreadFor, notices into threads someone else opened", () => {
  it("takes a one-way notice into a thread a person or another bot opened when `others` allows it", () => {
    for (const thread of ["by-person", "by-scout"]) expect(fromChief(thread, true)?.threadId).toBe(thread);
  });

  it("refuses with upstream's words when `others` says no, or is not given, and for any send that wants a report", () => {
    for (const thread of ["by-person", "by-scout"]) {
      expect(() => fromChief(thread, true, () => false)).toThrow(NOT_OPENED);
      expect(() => fromChief(thread, true, null)).toThrow(NOT_OPENED);
      expect(() => fromChief(thread, false)).toThrow(NOT_OPENED);
    }
  });

  it("lets what `others` throws through, so a thread can say why it takes nothing", () => {
    expect(() => fromChief("by-person", true, () => { throw new Error("waiting on the person"); })).toThrow("waiting on the person");
  });

  it("still refuses an archived thread, a room lane, and a thread outside its reach", () => {
    expect(() => fromChief("archived", true)).toThrow(NOT_OPENED);
    expect(() => fromChief("lane", true)).toThrow(NOT_OPENED);
    expect(() => fromChief("by-person", true, () => true, () => false)).toThrow(OUTSIDE_STAYS_HERE);
  });

  it("keeps a thread the sender opened working for both kinds of send, without asking `others`", () => {
    const never = () => { throw new Error("asked"); };
    expect(fromChief("by-chief", false, never)?.threadId).toBe("by-chief");
    expect(fromChief("by-chief", true, never)?.threadId).toBe("by-chief");
  });
});

describe("workThreadFor, a teammate's home", () => {
  // Chief once opened "by-chief" on Maus; the person kept talking there and it is now Maus's home.
  const home = (candidate: TaskRecord) => candidate.threadId === "by-chief";
  const send = (thread: string, notice: boolean, standing?: TaskRecord) => workThreadFor(
    { ...store, workThread: ((_bot: string, _from: string, _fromThread: string, _lane?: boolean, also: (candidate: TaskRecord) => boolean = () => true) => (standing && also(standing) ? standing : undefined)) as never },
    { botId: "maus", botName: "Maus", fromBotId: "chief", fromThreadId: "chief-chat", thread, notice, answering: undefined, also: () => true, reach: () => true, others: () => true, home });

  it("refuses new work named into the home, and says so instead of upstream's not-yours", () => {
    expect(() => send("by-chief", false)).toThrow(/Maus's main conversation with the person/);
    expect(() => send("by-person", false)).toThrow(NOT_OPENED);
  });

  it("still takes a one-way notice there", () => {
    expect(send("by-chief", true)?.threadId).toBe("by-chief");
  });

  it("opens a fresh work thread when the standing one has become the home, and keeps it for a notice", () => {
    const standing = tasks.find((candidate) => candidate.threadId === "by-chief")!;
    expect(send("standing", false, standing)).toBeUndefined();
    expect(send("standing", true, standing)?.threadId).toBe("by-chief");
    const other = task("other-work", by("chief", "Chief", "chief-chat"));
    expect(send("standing", false, other)?.threadId).toBe("other-work");
  });
});
