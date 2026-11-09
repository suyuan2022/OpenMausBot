// suyuan fork: every run of a routine writes into the routine's one conversation.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ROUTINE_SUPERSEDED } from "../routine-execution.ts";
import { RoutineManager } from "../routines.ts";
import { takesOverFrom } from "./routine-thread.ts";

const START = new Date(2026, 10, 10, 9, 0, 0).getTime();
const MIN = 60_000;
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function harness(file?: string) {
  const dir = file ? "" : mkdtempSync(join(tmpdir(), "omb-one-thread-"));
  if (dir) dirs.push(dir);
  let now = START, task = 0;
  const open = new Set<string>();
  const created: Array<{ title: string; threadId: string }> = [];
  const started: Array<{ threadId: string; prompt: string }> = [];
  const options = {
    file: file ?? join(dir, "routines.json"),
    now: () => now,
    emit: () => {},
    botState: () => "ready" as const,
    createTask: (_botId: string, title: string) => { const threadId = `thread-${++task}`; open.add(threadId); created.push({ title, threadId }); return { threadId }; },
    threadOpen: (_botId: string, threadId: string) => open.has(threadId),
    startTurn: async (_botId: string, threadId: string, prompt: string) => { started.push({ threadId, prompt }); },
  };
  const manager = new RoutineManager(options);
  const finish = (threadId: string) => manager.handleRuntimeEvent({ type: "turn.completed", threadId, ok: true } as never);
  return { manager, options, created, started, open, finish, at: (next: number) => { now = next; } };
}

const interval = { type: "interval", everyMinutes: 40, anchorAt: START } as const;
const make = (h: ReturnType<typeof harness>, extra: Record<string, unknown> = {}) =>
  h.manager.create({ name: "Outfit", prompt: "Pick an outfit.", botId: "scout", schedule: interval, ...extra });

async function runOnce(h: ReturnType<typeof harness>, minutes: number) {
  h.at(START + minutes * MIN);
  await h.manager.tick();
  const run = h.manager.listRuns().sort((a, b) => b.createdAt - a.createdAt || b.scheduledFor - a.scheduledFor)[0]!;
  return run;
}

describe("a routine keeps one conversation", () => {
  it("runs twice into one conversation, the second message after the first", async () => {
    const h = harness();
    make(h);
    await runOnce(h, 41);
    h.finish("thread-1");
    await runOnce(h, 82);
    expect(h.created).toHaveLength(1);
    expect(h.created[0]!.title).toBe("Outfit");
    expect(h.started.map((one) => one.threadId)).toEqual(["thread-1", "thread-1"]);
    expect(h.manager.listRoutines()[0]!.runThreadId).toBe("thread-1");
  });

  it("opens a new conversation once the old one is gone, and remembers that one", async () => {
    const h = harness();
    make(h);
    await runOnce(h, 41);
    h.finish("thread-1");
    h.open.delete("thread-1");
    await runOnce(h, 82);
    h.finish("thread-2");
    await runOnce(h, 123);
    expect(h.started.map((one) => one.threadId)).toEqual(["thread-1", "thread-2", "thread-2"]);
    expect(h.manager.listRoutines()[0]!.runThreadId).toBe("thread-2");
  });

  it("an upgraded routine with no pointer joins its latest run's open conversation, else opens one", async () => {
    const h = harness();
    const routine = make(h);
    await runOnce(h, 41);
    h.finish("thread-1");
    delete (h.manager as unknown as { routines: Array<{ runThreadId?: string }> }).routines[0]!.runThreadId;
    h.open.add("legacy"); // an old run that sat in its own conversation
    const run = h.manager.listRuns()[0]!;
    (h.manager as unknown as { runs: Array<{ id: string; threadId?: string }> }).runs.find((one) => one.id === run.id)!.threadId = "legacy";
    await runOnce(h, 82);
    expect(h.created).toHaveLength(1);
    expect(h.started.at(-1)!.threadId).toBe("legacy");
    expect(h.manager.listRoutines().find((one) => one.id === routine.id)!.runThreadId).toBe("legacy");
    h.finish("legacy");
    h.open.delete("legacy");
    (h.manager as unknown as { routines: Array<{ runThreadId?: string }> }).routines[0]!.runThreadId = undefined;
    await runOnce(h, 123);
    expect(h.created).toHaveLength(2);
  });

  it("never writes two runs into the conversation at once: a manual run beside a running one gets a conversation of its own, not remembered", async () => {
    const h = harness();
    const routine = make(h);
    await runOnce(h, 41);
    h.manager.runNow(routine.id);
    await h.manager.tick();
    expect(h.started.map((one) => one.threadId)).toEqual(["thread-1", "thread-2"]);
    expect(h.created[1]!.title).toContain("Outfit ·");
    expect(h.manager.listRoutines()[0]!.runThreadId).toBe("thread-1");
    h.finish("thread-1");
    h.finish("thread-2");
    await runOnce(h, 82);
    expect(h.started.at(-1)!.threadId).toBe("thread-1");
  });

  it("a run whose wait the next scheduled run superseded leaves its conversation closed: the next run opens a new one and the routine remembers it", async () => {
    const h = harness();
    make(h);
    await runOnce(h, 41);
    const runs = (h.manager as unknown as { runs: Array<{ status: string; waitingSince?: number; error?: string }> }).runs;
    runs[0]!.status = "cancelled";
    runs[0]!.waitingSince = START;
    runs[0]!.error = ROUTINE_SUPERSEDED;
    await runOnce(h, 82);
    expect(h.started.map((one) => one.threadId)).toEqual(["thread-1", "thread-2"]);
    expect(h.manager.listRoutines()[0]!.runThreadId).toBe("thread-2");
    h.finish("thread-2");
    await runOnce(h, 123);
    expect(h.started.at(-1)!.threadId).toBe("thread-2");
  });

  it("queue overlap still lines the next run up behind the running one", async () => {
    const h = harness();
    make(h, { overlap: "queue" });
    await runOnce(h, 41);
    await runOnce(h, 82);
    expect(h.started).toHaveLength(1);
    h.finish("thread-1");
    await h.manager.tick();
    expect(h.started.map((one) => one.threadId)).toEqual(["thread-1", "thread-1"]);
  });

  it("skip overlap drops the run that comes due while one is running", async () => {
    const h = harness();
    make(h);
    await runOnce(h, 41);
    await runOnce(h, 82);
    expect(h.started).toHaveLength(1);
    expect(h.manager.listRoutines()[0]!.skippedRuns).toBe(1);
  });

  it("does not carry the previous report into the conversation that already holds it", async () => {
    const h = harness();
    make(h, { continuity: true });
    const first = await runOnce(h, 41);
    h.finish("thread-1");
    (h.manager as unknown as { runs: Array<{ id: string; output?: string }> }).runs.find((one) => one.id === first.id)!.output = "REPORT-ONE";
    await runOnce(h, 82);
    expect(h.started[1]!.prompt).not.toContain("REPORT-ONE");
    expect(h.started[1]!.threadId).toBe("thread-1");
  });

  it("leaves one-shot routines on a conversation per run", async () => {
    const h = harness();
    h.manager.create({ name: "Once", prompt: "Do it.", botId: "scout", schedule: { type: "once", at: START + MIN } });
    h.at(START + 2 * MIN);
    await h.manager.tick();
    expect(h.manager.listRoutines()[0]!.runThreadId).toBeUndefined();
    expect(h.created[0]!.title).toContain("Once ·");
  });

  const hook = (h: ReturnType<typeof harness>, n: number, extra: Record<string, unknown> = {}) => h.manager.enqueueWebhook({
    webhookId: "hook-1", webhookName: "Crew chat", prompt: `event ${n}`, botId: "scout", runOn: "maus", deliveryId: `d${n}`, receivedAt: START + n, ...extra,
  });

  it("a webhook has no routine, yet its runs share one conversation named for it", async () => {
    const h = harness();
    hook(h, 1);
    await h.manager.tick();
    h.finish("thread-1");
    hook(h, 2);
    await h.manager.tick();
    expect(h.created).toEqual([{ title: "Crew chat", threadId: "thread-1" }]);
    expect(h.started.map((one) => one.threadId)).toEqual(["thread-1", "thread-1"]);
  });

  it("a connected-app event does the same", async () => {
    const h = harness();
    hook(h, 1, { eventSource: "app" });
    await h.manager.tick();
    h.finish("thread-1");
    hook(h, 2, { eventSource: "app" });
    await h.manager.tick();
    expect(h.created).toHaveLength(1);
  });

  it("a webhook run beside a running one gets a conversation of its own", async () => {
    const h = harness();
    hook(h, 1);
    await h.manager.tick();
    hook(h, 2);
    await h.manager.tick();
    expect(h.started.map((one) => one.threadId)).toEqual(["thread-1", "thread-2"]);
  });

  it("a webhook run goes to a conversation of its own while the last one waits for an answer, and its conversation is gone once deleted", async () => {
    const h = harness();
    hook(h, 1);
    await h.manager.tick();
    (h.manager as unknown as { runs: Array<{ status: string }> }).runs[0]!.status = "waiting";
    hook(h, 2);
    await h.manager.tick();
    expect(h.started.map((one) => one.threadId)).toEqual(["thread-1", "thread-2"]);
    h.open.delete("thread-1");
    h.open.delete("thread-2");
    h.finish("thread-2");
    hook(h, 3);
    await h.manager.tick();
    expect(h.started.at(-1)!.threadId).toBe("thread-3");
  });

  it("does not look for an earlier run's conversation once the routine's own is gone", async () => {
    const h = harness();
    const routine = make(h);
    await runOnce(h, 41);
    h.finish("thread-1");
    // The routine's recorded conversation is deleted, while another conversation of an earlier run (opened while one waited) is still open.
    h.open.add("side");
    (h.manager as unknown as { runs: Array<{ threadId?: string; createdAt: number }> }).runs[0]!.threadId = "side";
    (h.manager as unknown as { runs: Array<{ threadId?: string; createdAt: number }> }).runs[0]!.createdAt = START + 100 * MIN;
    h.open.delete("thread-1");
    await runOnce(h, 82);
    expect(h.started.at(-1)!.threadId).toBe("thread-2");
    expect(h.manager.listRoutines().find((one) => one.id === routine.id)!.runThreadId).toBe("thread-2");
  });

  it("still carries the previous report when that run sits in another conversation", async () => {
    const h = harness();
    make(h, { continuity: true });
    const first = await runOnce(h, 41);
    h.finish("thread-1");
    const runs = (h.manager as unknown as { runs: Array<{ id: string; output?: string; threadId?: string }> }).runs;
    const stored = runs.find((one) => one.id === first.id)!;
    stored.output = "REPORT-ONE";
    stored.threadId = "elsewhere"; // the report was written in a conversation this routine no longer writes to
    await runOnce(h, 82);
    expect(h.started[1]!.threadId).toBe("thread-1");
    expect(h.started[1]!.prompt).toContain("REPORT-ONE");
  });

  it("leaves a Cloud server and the off switch on a conversation per run", async () => {
    for (const [key, value] of [["OMB_CLOUD_ROLE", "home"], ["OMB_ROUTINE_ONE_THREAD", "0"]] as const) {
      vi.stubEnv(key, value);
      const h = harness();
      make(h);
      await runOnce(h, 41);
      h.finish("thread-1");
      await runOnce(h, 82);
      expect(h.created, key).toHaveLength(2);
      vi.unstubAllEnvs();
    }
  });

  it("a run that waited for approval and was stopped by hand does not close the conversation", async () => {
    const h = harness();
    make(h);
    await runOnce(h, 41);
    const runs = (h.manager as unknown as { runs: Array<{ status: string; waitingSince?: number; error?: string }> }).runs;
    runs[0]!.status = "cancelled";
    runs[0]!.waitingSince = START;
    runs[0]!.error = "Stopped by you";
    await runOnce(h, 82);
    expect(h.started.map((one) => one.threadId)).toEqual(["thread-1", "thread-1"]);
  });

  it("a webhook run opened beside a working one is not where the next run goes", async () => {
    const h = harness();
    hook(h, 1);
    await h.manager.tick();
    hook(h, 2);
    await h.manager.tick();
    expect(h.started.map((one) => one.threadId)).toEqual(["thread-1", "thread-2"]);
    expect(h.manager.listRuns().filter((run) => run.sideThread).map((run) => run.threadId)).toEqual(["thread-2"]);
    h.finish("thread-1");
    h.finish("thread-2");
    hook(h, 3);
    await h.manager.tick();
    expect(h.started.at(-1)!.threadId).toBe("thread-1");
    expect(h.created).toHaveLength(2);
  });

  it("marks the conversation as the new run's when the run that held the mark has left the history", () => {
    const run = { id: "now", routineId: "r1" };
    expect(takesOverFrom("old", run, undefined)).toBe(true);
    expect(takesOverFrom("old", run, null)).toBe(true);
    expect(takesOverFrom("old", run, { routineId: "r1" })).toBe(true);
    expect(takesOverFrom("old", run, { routineId: "other" })).toBe(false);
    expect(takesOverFrom("now", run, undefined)).toBe(false);
    // A person who wrote in the conversation cleared the mark: it stays theirs.
    expect(takesOverFrom(undefined, run, undefined)).toBe(false);
  });

  it("finds a run by id for the host, and not once it is gone", async () => {
    const h = harness();
    make(h);
    const run = await runOnce(h, 41);
    expect(h.manager.runById(run.id)?.id).toBe(run.id);
    expect(h.manager.runById("missing")).toBeNull();
  });
});
