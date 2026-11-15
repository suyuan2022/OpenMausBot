// suyuan fork: the runtime's one exception to "never hand work back to an ancestor" (suyuan/self-thread.ts). A
// conversation's own turn may hand work to another conversation of the same bot; every other way back stays refused.
import { describe, expect, it } from "vitest";

import { checkInvariants } from "./invariants.ts";
import { Runtime, type BeginRequest } from "./runtime.ts";
import { openRuntimeStore } from "./store.ts";
import type { Assignment, EnqueueRequest, RunResult, TurnRunner } from "./types.ts";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function world() {
  const store = openRuntimeStore(":memory:");
  const runs: Assignment[] = [];
  const held = new Map<string, (result: RunResult) => void>();
  const reports: Array<{ id: string; to?: string }> = [];
  const runner: TurnRunner = {
    validate: () => undefined,
    canStart: () => true,
    run(a) {
      runs.push(a);
      return new Promise<RunResult>((resolve) => held.set(a.id, resolve));
    },
    park: () => {},
    report(a, parent) { reports.push({ id: a.id, ...(parent ? { to: parent.id } : {}) }); },
    changed: () => {},
    names: (a) => ({ requester: a.requester.botId ?? "Sam", assignee: a.assignee.botId, person: "Sam" }),
  };
  let t = 1_000_000;
  const runtime = new Runtime(store, runner, { clock: { now: () => t, monotonic: () => t }, limits: {}, log: () => {} });
  runtime.open();
  const finish = async (id: string, text: string) => { held.get(id)!({ kind: "completed", text }); held.delete(id); await flush(); };
  const live = () => ({ running: new Set(held.keys()), parked: new Set<string>() });
  return { store, runtime, runs, reports, finish, live, tick: () => { t += 1; runtime.tick(); } };
}

const begin: BeginRequest = {
  origin: { kind: "person", source: "chat", quote: "Count the files" },
  requester: { kind: "person", threadId: "clive-home", chief: true },
  assignee: { botId: "clive", destination: { kind: "standing_thread", threadId: "clive-home" } }, brief: "Count the files", level: "auto",
};
const to = (botId: string, threadId: string, parentId: string, from: { botId: string; threadId: string }, brief = `Work for ${threadId}`): EnqueueRequest => ({
  parentId, origin: { kind: "person", source: "chat" }, requester: { kind: "bot_turn", ...from },
  assignee: { botId, destination: { kind: "work_thread", threadId } }, brief, levels: { own: "auto" }, driverKind: "claudeAgent",
});
const home = { botId: "clive", threadId: "clive-home" };

describe("a thread a bot opens on itself, in the runtime", () => {
  it("runs beside its opener's other threads and resumes the opening conversation once with both results", async () => {
    const w = world();
    const root = w.runtime.begin(begin);
    const a = w.runtime.enqueue(to("clive", "clive-a", root.id, home));
    const b = w.runtime.enqueue(to("clive", "clive-b", root.id, home));
    expect(a).toMatchObject({ ok: true, assignment: { depth: 1, parentId: root.id } });
    expect(b).toMatchObject({ ok: true });
    if (!a.ok || !b.ok) return;
    w.tick();
    // The same bot's two threads run at once, while the opening conversation's own turn still runs.
    expect(w.store.get(root.id)?.status).toBe("running");
    expect(w.runs.map((run) => run.assignee.destination.threadId)).toEqual(["clive-a", "clive-b"]);
    w.runtime.end(root.id, { ok: true, text: "opened two" });
    expect(w.store.get(root.id)?.status).toBe("waiting");
    await w.finish(a.assignment.id, "A done");
    w.tick();
    expect(w.runs, "one result does not wake it while the other thread runs").toHaveLength(2);
    await w.finish(b.assignment.id, "B done");
    w.tick();
    expect(w.reports.map((report) => report.to)).toEqual([root.id, root.id]);
    const resumed = w.runs.filter((run) => run.id === root.id);
    expect(resumed, "the opening conversation is resumed once, with both").toHaveLength(1);
    expect(w.store.get(root.id)?.status).toBe("running");
    expect(checkInvariants(w.store, w.live())).toEqual([]);
  });

  it("still refuses a turn's own conversation, a thread opened from a thread, and work that comes back through a teammate", async () => {
    const w = world();
    const root = w.runtime.begin(begin);
    expect(w.runtime.enqueue(to("clive", "clive-home", root.id, home))).toMatchObject({ ok: false, outcome: "refused", reason: /ancestor/ });
    const side = w.runtime.enqueue(to("clive", "clive-a", root.id, home));
    const mira = w.runtime.enqueue(to("mira", "mira-work", root.id, home));
    if (!side.ok || !mira.ok) throw new Error("the first hand-offs were refused");
    w.tick();
    // The thread it opened may not open another, nor write to its opener or a sibling thread as work.
    const fromSide = { botId: "clive", threadId: "clive-a" };
    expect(w.runtime.enqueue(to("clive", "clive-c", side.assignment.id, fromSide))).toMatchObject({ ok: false, outcome: "refused", reason: /ancestor/ });
    expect(w.runtime.enqueue(to("clive", "clive-home", side.assignment.id, fromSide))).toMatchObject({ ok: false, outcome: "refused", reason: /ancestor/ });
    // A teammate may not hand the work back, into any conversation of the bot it came from.
    const fromMira = { botId: "mira", threadId: "mira-work" };
    expect(w.runtime.enqueue(to("clive", "clive-home", mira.assignment.id, fromMira))).toMatchObject({ ok: false, outcome: "refused", reason: /ancestor/ });
    expect(w.runtime.enqueue(to("clive", "clive-d", mira.assignment.id, fromMira))).toMatchObject({ ok: false, outcome: "refused", reason: /ancestor/ });
    expect(w.runtime.enqueue(to("mira", "mira-other", mira.assignment.id, fromMira))).toMatchObject({ ok: false, outcome: "refused", reason: /ancestor/ });
  });
});
