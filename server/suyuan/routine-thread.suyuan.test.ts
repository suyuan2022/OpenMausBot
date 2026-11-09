// suyuan fork: every run of a routine writes into the routine's one conversation.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { RoutineManager } from "../routines.ts";

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

  it("never writes two runs into the conversation at once: a manual run waits for the scheduled one", async () => {
    const h = harness();
    const routine = make(h);
    await runOnce(h, 41);
    h.manager.runNow(routine.id);
    await h.manager.tick();
    expect(h.started).toHaveLength(1);
    h.finish("thread-1");
    await h.manager.tick();
    expect(h.started.map((one) => one.threadId)).toEqual(["thread-1", "thread-1"]);
    expect(h.created).toHaveLength(1);
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
});
