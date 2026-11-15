// suyuan fork: the "command" check of a routine (shared/suyuan/check-first.ts says how it is written). Upstream's
// scheduler already looks before it runs for a routine with checks: nothing new leaves no run, no conversation and no
// notice; something to do becomes one run. Its checks read the calendar, mail and earlier runs. This adds one that runs
// a shell command: exit 0 lets the routine run, with what the command printed added to the instructions; any other exit
// skips this time. A command that cannot run at all is trouble the routine shows, since a check that never passes looks
// the same as nothing new.
import { execFile } from "node:child_process";
import { checkFirst } from "../../shared/suyuan/check-first.ts";
import { plainText } from "../../shared/suyuan/plain-reminder.ts";
import type { RoutineChecks } from "../routines.ts";

const KEY = "command-";
const OUTPUT_CHARS = 8000;
export const COMMAND_SECONDS = 60;

/** How a command ended: its exit code, or null with why when it never ran to an exit. */
export type CommandOutcome = { code: number | null; output: string; why?: string };

export interface CommandCheckDeps {
  /** A command runs unasked, so only for a bot at Full access. */
  mayRun(botId: string): boolean;
  /** The bot's working folder, where the command runs. */
  cwd(botId: string): string | undefined;
  run?(command: string, cwd: string | undefined): Promise<CommandOutcome>;
  now?(): number;
}

/** Runs one command in the person's login shell, so it finds what their terminal finds. */
export function runCommand(command: string, cwd: string | undefined): Promise<CommandOutcome> {
  return new Promise((resolve) => {
    execFile(process.env.SHELL || "/bin/sh", ["-lc", command], { cwd, timeout: COMMAND_SECONDS * 1000, maxBuffer: 1 << 20, encoding: "utf8" }, (error, stdout) => {
      if (!error) return resolve({ code: 0, output: stdout });
      const code = typeof error.code === "number" ? error.code : null;
      resolve({ code, output: stdout, ...(error.killed ? { why: `超过 ${COMMAND_SECONDS} 秒没跑完` } : code === null ? { why: error.message } : {}) });
    });
  });
}

/** Upstream's checks, with the command check in front of them. */
export function commandChecks(upstream: RoutineChecks | undefined, deps: CommandCheckDeps): RoutineChecks {
  const run = deps.run ?? runCommand, own = (key: string | undefined) => key?.startsWith(KEY) === true;
  return {
    async check(routine, context) {
      if (!routine.checks?.includes("command")) return upstream ? upstream.check(routine, context) : {};
      const first = checkFirst(routine.prompt), key = `${KEY}${routine.id}-${(deps.now ?? Date.now)()}`.slice(0, 128);
      // The mark was edited away: there is nothing to wait for.
      if (!first) return { run: { prompt: routine.prompt, key } };
      // Its last run still works, or it ran as often as a checked routine may in a day: the command waits too, so a
      // command that hands over what is new does not hand it to nobody.
      if (context.hold) return context.hold === "capped" ? { trouble: "这个任务过去 24 小时已经跑满 24 次，先不检查了，过一阵自动恢复。" } : {};
      if (!deps.mayRun(routine.botId)) return { trouble: `检查命令没跑：这个 bot 不是「完全访问」权限。命令：${first.command}` };
      const outcome = await run(first.command, deps.cwd(routine.botId));
      if (outcome.code === 0) {
        const output = outcome.output.trim().slice(0, OUTPUT_CHARS);
        // A plain reminder is sent word for word, so nothing is added to it.
        return { run: { key, prompt: !output || plainText(first.rest) !== null ? first.rest : `${first.rest}\n\n检查命令（${first.command}）这次的输出：\n${output}` } };
      }
      // 126 and 127 are the shell saying the command could not be run or found.
      if (outcome.code !== null && outcome.code < 126) return {};
      return { trouble: `检查命令没跑成（${outcome.why ?? `退出码 ${outcome.code}`}）：${first.command}` };
    },
    release(key) { if (!own(key)) upstream?.release(key); },
    settled(run) { if (!own(run.checkKey)) upstream?.settled(run); },
  };
}
