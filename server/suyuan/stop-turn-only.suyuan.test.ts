// suyuan fork: cutting a conversation's running turn (Stop, a message of the person's that goes first, a restart) leaves
// the work it handed out running, and that work's results still resume the conversation (stop-turn-only.ts). A typed
// stop keeps upstream's full stop.
import { describe, expect, it } from "vitest";

import { checkInvariants } from "../runtime/invariants.ts";
import { Runtime, type BeginRequest } from "../runtime/runtime.ts";
import { openRuntimeStore } from "../runtime/store.ts";
import type { Assignment, EnqueueRequest, RunResult, TurnRunner } from "../runtime/types.ts";
import { personStopScope } from "./stop-turn-only.ts";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function world() {
  const store = openRuntimeStore(":memory:");
  const runs: Array<{ a: Assignment; signal: AbortSignal }> = [];
  const held = new Map<string, (result: RunResult) => void>();
  const runner: TurnRunner = {
    validate: () => undefined,
    canStart: () => true,
    run(a, _input, signal) {
      runs.push({ a, signal });
      return new Promise<RunResult>((resolve) => held.set(a.id, resolve));
    },
    park: () => {},
    report: () => {},
    changed: () => {},
    names: (a) => ({ requester: a.requester.botId ?? "Sam", assignee: a.assignee.botId, person: "Sam" }),
  };
  let t = 1_000_000;
  const runtime = new Runtime(store, runner, { clock: { now: () => t, monotonic: () => t }, limits: {}, log: () => {} });
  runtime.open();
  const finish = async (id: string, text: string) => { held.get(id)!({ kind: "completed", text }); held.delete(id); await flush(); };
  const live = () => ({ running: new Set(held.keys()), parked: new Set<string>() });
  return { store, runtime, runs, held, finish, live, tick: () => { t += 1; runtime.tick(); } };
}

const begin = (quote = "Make the collage"): BeginRequest => ({
  origin: { kind: "person", source: "chat", quote },
  requester: { kind: "person", threadId: "lychee-home", chief: true },
  assignee: { botId: "lychee", destination: { kind: "standing_thread", threadId: "lychee-home" } }, brief: quote, level: "auto",
});
const home = { botId: "lychee", threadId: "lychee-home" };
const to = (botId: string, threadId: string, parentId: string, brief = `Work for ${threadId}`): EnqueueRequest => ({
  parentId, origin: { kind: "person", source: "chat" }, requester: { kind: "bot_turn", ...home },
  assignee: { botId, destination: { kind: "work_thread", threadId } }, brief, levels: { own: "auto" }, driverKind: "claudeAgent",
});
const ok = (result: ReturnType<Runtime["enqueue"]>): Assignment => {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.assignment;
};

describe("stopping only a conversation's running turn", () => {
  it("leaves its own thread and a teammate running, and resumes the conversation with both results", async () => {
    const w = world();
    const root = w.runtime.begin(begin());
    const side = ok(w.runtime.enqueue(to("lychee", "lychee-collage", root.id)));
    const mate = ok(w.runtime.enqueue(to("writer", "writer-work", root.id)));
    w.tick();
    expect(w.runs.map((run) => run.a.id)).toEqual([side.id, mate.id]);

    w.runtime.stopRequesterTurn({ threadId: "lychee-home" }, "Stopped a step that had run for 60 s, to answer you first");
    expect(w.store.get(root.id)?.status, "the cut turn waits on what it handed out").toBe("waiting");
    expect(w.store.get(side.id)?.status).toBe("running");
    expect(w.store.get(mate.id)?.status).toBe("running");
    expect(w.runs.every((run) => !run.signal.aborted), "nothing handed out is aborted").toBe(true);
    // The host's own end of the cut turn arrives late and changes nothing.
    w.runtime.end(root.id, { ok: false, text: "The turn was stopped" });
    expect(w.store.get(root.id)?.status).toBe("waiting");

    await w.finish(side.id, "Collage done");
    w.tick();
    expect(w.runs.some((run) => run.a.id === root.id), "one result does not wake it while the other runs").toBe(false);
    await w.finish(mate.id, "Copy done");
    w.tick();
    const resumed = w.runs.filter((run) => run.a.id === root.id);
    expect(resumed).toHaveLength(1);
    expect(resumed[0]!.a.status).toBe("running");
    expect(w.store.get(side.id)).toMatchObject({ status: "completed", result: "Collage done" });
    expect(w.store.get(mate.id)).toMatchObject({ status: "completed", result: "Copy done" });
    expect(checkInvariants(w.store, w.live())).toEqual([]);
  });

  it("ends a turn that handed nothing out as a stop, as before", () => {
    const w = world();
    const root = w.runtime.begin(begin());
    w.runtime.stopRequesterTurn({ threadId: "lychee-home" }, "Stopped by user");
    expect(w.store.get(root.id)).toMatchObject({ status: "cancelled", outcome: "stopped" });
    expect(checkInvariants(w.store, w.live())).toEqual([]);
  });

  it("leaves an earlier request that already waits on its thread alone", async () => {
    const w = world();
    const earlier = w.runtime.begin(begin("Open a thread for the collage"));
    const side = ok(w.runtime.enqueue(to("lychee", "lychee-collage", earlier.id)));
    w.runtime.end(earlier.id, { ok: true, text: "Opened it." });
    w.tick();
    expect(w.store.get(earlier.id)?.status).toBe("waiting");
    const now = w.runtime.begin(begin("Also check the tweets"));
    w.runtime.stopRequesterTurn({ threadId: "lychee-home" }, "Stopped by user");
    expect(w.store.get(now.id)).toMatchObject({ status: "cancelled", outcome: "stopped" });
    expect(w.store.get(earlier.id)?.status).toBe("waiting");
    expect(w.store.get(side.id)?.status).toBe("running");
    await w.finish(side.id, "Collage done");
    w.tick();
    expect(w.runs.filter((run) => run.a.id === earlier.id)).toHaveLength(1);
    expect(checkInvariants(w.store, w.live())).toEqual([]);
  });

  it("still hands back work that finished before the turn was cut", async () => {
    const w = world();
    const root = w.runtime.begin(begin());
    const side = ok(w.runtime.enqueue(to("lychee", "lychee-collage", root.id)));
    w.tick();
    await w.finish(side.id, "Collage done");
    expect(w.store.get(side.id)?.status).toBe("completed");
    w.runtime.stopRequesterTurn({ threadId: "lychee-home" }, "Stopped by user");
    expect(w.store.get(root.id)?.status).not.toBe("cancelled");
    w.tick();
    expect(w.runs.filter((run) => run.a.id === root.id), "the conversation is resumed with the result").toHaveLength(1);
    expect(checkInvariants(w.store, w.live())).toEqual([]);
  });

  it("keeps work that has not started yet queued", () => {
    const w = world();
    const root = w.runtime.begin(begin());
    const queued = ok(w.runtime.enqueue(to("writer", "writer-work", root.id)));
    w.runtime.stopRequesterTurn({ threadId: "lychee-home" }, "Stopped by user");
    expect(w.store.get(root.id)?.status).toBe("waiting");
    expect(w.store.get(queued.id)?.status).toBe("queued");
    w.tick();
    expect(w.runs.map((run) => run.a.id)).toEqual([queued.id]);
  });

  it("a full stop still ends everything the conversation handed out", () => {
    const w = world();
    const root = w.runtime.begin(begin());
    const side = ok(w.runtime.enqueue(to("lychee", "lychee-collage", root.id)));
    w.tick();
    w.runtime.stopRequester({ threadId: "lychee-home" });
    expect(w.store.get(root.id)).toMatchObject({ status: "cancelled", outcome: "stopped" });
    expect(w.store.get(side.id)).toMatchObject({ status: "cancelled", outcomeDetail: "Stopped with the request it was for" });
  });
});

describe("which stop a person's Stop is", () => {
  it("cuts only the turn for the Stop button while the turn runs and for a restart; a typed stop, or Stop with only handed-out work left, ends all", () => {
    expect(personStopScope("button", true)).toBe("turn");
    expect(personStopScope("restart", true)).toBe("turn");
    expect(personStopScope("button", false)).toBe("all");
    expect(personStopScope("typed", true)).toBe("all");
    expect(personStopScope("typed", false)).toBe("all");
  });
});
