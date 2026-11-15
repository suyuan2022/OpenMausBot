import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { withCheck } from "../../shared/suyuan/check-first.ts";
import { asPlain } from "../../shared/suyuan/plain-reminder.ts";
import { CHECK_BOOT_HOLD_MS } from "../routine-check-pacing.ts";
import { RoutineManager, type RoutineChecks, type RoutineRun } from "../routines.ts";
import { commandChecks, runCommand, type CommandOutcome } from "./check-first.ts";
import { deliverPlainReminder } from "./plain-reminder.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const START = new Date(2026, 10, 16, 8, 0, 0).getTime(), MINUTE = 60_000;
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/** A scheduler wired the way server/index.ts wires it, with a command whose outcome the test decides. */
function scheduler(outcome: () => CommandOutcome, full = true) {
  const dir = mkdtempSync(join(tmpdir(), "omb-check-first-"));
  dirs.push(dir);
  let now = START;
  const turns: string[] = [], said: string[] = [], reported: RoutineRun[] = [], ran: string[] = [], upstream: string[] = [];
  const theirs: RoutineChecks = { check: async (routine) => { upstream.push(routine.id); return {}; }, release: () => {}, settled: () => {} };
  const routines: RoutineManager = new RoutineManager({
    file: join(dir, "routines.json"),
    now: () => now,
    botState: () => "ready",
    createTask: () => ({ threadId: `thread-${turns.length + said.length + 1}` }),
    checks: commandChecks(theirs, { mayRun: () => full, cwd: () => dir, now: () => now, run: async (command) => { ran.push(command); return outcome(); } }),
    startTurn: async (_botId, threadId, prompt) => {
      const plain = deliverPlainReminder(threadId, {
        run: (id) => routines.runForThread(id),
        say: (_id, text) => { said.push(text); },
        settle: (event) => routines.handleRuntimeEvent(event),
        report: (run) => { reported.push(run); },
      });
      if (!plain) turns.push(prompt);
    },
  });
  /** Moves the clock and lets the scheduler pass, its check and the pass the check asks for all finish. */
  const pass = async (ms: number) => { now = ms; await routines.tick(); await settle(); await routines.tick(); await settle(); };
  const every = (prompt: string, checks: Array<"command" | "mail"> = ["command"]) =>
    routines.create({ name: "看新消息", prompt, botId: "bot-1", schedule: { type: "interval", everyMinutes: 15, anchorAt: START + 15 * MINUTE }, checks });
  return { routines, turns, said, reported, ran, upstream, pass, every };
}

describe("a routine that runs a command first", () => {
  it("leaves nothing behind while the command says no, and runs once it says yes, with what the command printed", async () => {
    let outcome: CommandOutcome = { code: 1, output: "" };
    const h = scheduler(() => outcome);
    const routine = h.every(withCheck("wx-fresh-check.sh", "把新消息整理成三行告诉夙愿"));
    await h.pass(START + 16 * MINUTE);
    await h.pass(START + 31 * MINUTE);
    expect(h.ran).toEqual(["wx-fresh-check.sh", "wx-fresh-check.sh"]);
    expect(h.routines.listRuns()).toEqual([]);
    expect(h.turns).toEqual([]);
    expect(h.routines.listRoutines()[0]).toMatchObject({ id: routine.id, enabled: true });
    expect(h.routines.listRoutines()[0]!.checkTrouble).toBeUndefined();

    outcome = { code: 0, output: "小齐：到家了吗\n" };
    await h.pass(START + 46 * MINUTE);
    expect(h.turns).toHaveLength(1);
    expect(h.turns[0]).toContain("把新消息整理成三行告诉夙愿");
    expect(h.turns[0]).toContain("小齐：到家了吗");
    expect(h.turns[0]).not.toContain("【先跑命令");
    expect(h.routines.listRuns()).toHaveLength(1);
    expect(h.upstream).toEqual([]);
  });

  it("sends a plain reminder as it is once the command says yes, with no turn", async () => {
    const h = scheduler(() => ({ code: 0, output: "ignored" }));
    h.every(withCheck("test -f arrived", asPlain("包裹到了，去拿")));
    await h.pass(START + 16 * MINUTE);
    expect(h.turns).toEqual([]);
    expect(h.said).toEqual(["包裹到了，去拿"]);
    expect(h.reported).toHaveLength(1);
  });

  it("says so on the routine when the command cannot run, and never runs one for a bot below Full access", async () => {
    const broken = scheduler(() => ({ code: 127, output: "" }));
    broken.every(withCheck("no-such-script", "做事"));
    await broken.pass(START + 16 * MINUTE);
    expect(broken.routines.listRuns()).toEqual([]);
    expect(broken.routines.listRoutines()[0]!.checkTrouble).toMatch(/检查命令没跑成（退出码 127）：no-such-script/);

    const slow = scheduler(() => ({ code: null, output: "", why: "超过 60 秒没跑完" }));
    slow.every(withCheck("sleep 100", "做事"));
    await slow.pass(START + 16 * MINUTE);
    expect(slow.routines.listRoutines()[0]!.checkTrouble).toMatch(/超过 60 秒没跑完/);

    const asking = scheduler(() => ({ code: 0, output: "" }), false);
    asking.every(withCheck("touch pwned", "做事"));
    await asking.pass(START + 16 * MINUTE);
    expect(asking.ran).toEqual([]);
    expect(asking.turns).toEqual([]);
    expect(asking.routines.listRoutines()[0]!.checkTrouble).toMatch(/完全访问/);

    // A routine fenced to reading and drafting never runs a command either.
    const fenced = scheduler(() => ({ code: 0, output: "" }));
    fenced.routines.create({ name: "只读", prompt: withCheck("touch pwned", "做事"), botId: "bot-1", schedule: { type: "interval", everyMinutes: 15, anchorAt: START + 15 * MINUTE }, checks: ["command"], access: "read-and-draft" });
    await fenced.pass(START + 16 * MINUTE);
    expect(fenced.ran).toEqual([]);
    expect(fenced.turns).toEqual([]);
  });

  it("does not run the command again while the run it started still works", async () => {
    const h = scheduler(() => ({ code: 0, output: "" }));
    h.every(withCheck("true", "做事"));
    await h.pass(START + 16 * MINUTE);
    await h.pass(START + 31 * MINUTE);
    expect(h.ran).toEqual(["true"]);
    expect(h.turns).toHaveLength(1);
  });

  it("leaves upstream's checks to upstream", async () => {
    const h = scheduler(() => ({ code: 0, output: "" }));
    h.every("看邮件", ["mail"]);
    await h.pass(START + CHECK_BOOT_HOLD_MS + 16 * MINUTE);
    expect(h.ran).toEqual([]);
    expect(h.upstream).toHaveLength(1);
  });
});

describe("running the command", () => {
  it("answers with the exit code and what was printed, in the folder given", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-check-run-"));
    dirs.push(dir);
    writeFileSync(join(dir, "new.txt"), "一条新消息\n");
    expect(await runCommand("cat new.txt", dir)).toMatchObject({ code: 0, output: "一条新消息\n" });
    expect(await runCommand("test -f missing.txt", dir)).toMatchObject({ code: 1 });
    expect((await runCommand("no-such-command-omb-test", dir)).code).toBe(127);
  });
});
