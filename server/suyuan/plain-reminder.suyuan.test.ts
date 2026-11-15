import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { asPlain } from "../../shared/suyuan/plain-reminder.ts";
import { RoutineManager, type RoutineRun } from "../routines.ts";
import { deliverPlainReminder } from "./plain-reminder.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const START = new Date(2026, 10, 16, 8, 0, 0).getTime();

/** A scheduler wired the way server/index.ts wires it: a turn is asked for only when the run is not a plain reminder. */
function scheduler() {
  const dir = mkdtempSync(join(tmpdir(), "omb-plain-reminder-"));
  dirs.push(dir);
  let now = START;
  const turns: string[] = [], said: Array<{ threadId: string; text: string }> = [], reported: RoutineRun[] = [];
  const routines: RoutineManager = new RoutineManager({
    file: join(dir, "routines.json"),
    now: () => now,
    botState: () => "ready",
    createTask: () => ({ threadId: `thread-${turns.length + said.length + 1}` }),
    startTurn: async (_botId, threadId, prompt) => {
      const plain = deliverPlainReminder(threadId, {
        run: (id) => routines.runForThread(id),
        say: (id, text) => { said.push({ threadId: id, text }); },
        settle: (event) => routines.handleRuntimeEvent(event),
        report: (run) => { reported.push(run); },
      });
      if (!plain) turns.push(prompt);
    },
  });
  return { routines, turns, said, reported, at: (ms: number) => { now = ms; } };
}

describe("a plain reminder when it is due", () => {
  it("is posted as it is and completes its run, with no turn", async () => {
    const { routines, turns, said, reported, at } = scheduler();
    const routine = routines.create({ name: "供暖", prompt: asPlain("记得跟小齐说一声，问问物业什么时候供暖"), botId: "bot-1", schedule: { type: "once", at: START + 60_000 } });
    at(START + 61_000);
    await routines.tick();
    expect(turns).toEqual([]);
    expect(said).toEqual([{ threadId: "thread-1", text: "记得跟小齐说一声，问问物业什么时候供暖" }]);
    const run = routines.listRuns().find((candidate) => candidate.routineId === routine.id)!;
    expect(run).toMatchObject({ status: "completed", output: "记得跟小齐说一声，问问物业什么时候供暖", threadId: "thread-1" });
    expect(reported.map((one) => one.id)).toEqual([run.id]);
  });

  it("leaves a routine written for a model to its turn", async () => {
    const { routines, turns, said, at } = scheduler();
    routines.create({ name: "查证书", prompt: "查证书到期日，告诉夙愿", botId: "bot-1", schedule: { type: "once", at: START + 60_000 } });
    at(START + 61_000);
    await routines.tick();
    expect(said).toEqual([]);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toContain("查证书到期日，告诉夙愿");
  });

  it("is sent again by Run now, and on each occurrence of a repeating schedule", async () => {
    const { routines, said, at } = scheduler();
    const routine = routines.create({ name: "礼品卡", prompt: asPlain("今天该充值苹果礼品卡了"), botId: "bot-1", schedule: { type: "interval", everyMinutes: 60, anchorAt: START } });
    routines.runNow(routine.id);
    await routines.tick();
    at(START + 61 * 60_000);
    await routines.tick();
    expect(said.map((one) => one.text)).toEqual(["今天该充值苹果礼品卡了", "今天该充值苹果礼品卡了"]);
    expect(routines.listRuns().filter((run) => run.routineId === routine.id).every((run) => run.status === "completed")).toBe(true);
  });
});
