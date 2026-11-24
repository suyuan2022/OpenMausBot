// suyuan fork: a scheduled routine that looks before it runs. Instructions that open with CHECK_MARK and a shell
// command on that same line are not handed to a model when the routine is due: the command runs first, with no AI, and
// only when it exits 0 does the rest of the instructions run (as a model's turn, or sent as it is when the rest is a
// plain reminder, ./plain-reminder.ts). Any other exit skips that occurrence and leaves nothing behind. Like the plain
// mark, the command lives in the instructions, so it travels wherever a routine goes with no field of its own; the
// routine's checks (shared/routines.ts, "command") tell the scheduler to look first.

export const CHECK_MARK = "【先跑命令，成功才继续】";

/** The command a routine runs first and the instructions that follow it, or null when it has none. */
export function checkFirst(prompt: string | undefined | null): { command: string; rest: string } | null {
  const text = (prompt ?? "").trimStart();
  if (!text.startsWith(CHECK_MARK)) return null;
  const [line = "", ...rest] = text.slice(CHECK_MARK.length).split("\n");
  const command = line.trim();
  return command ? { command, rest: rest.join("\n").trim() } : null;
}

/** The instructions without their check. */
export const afterCheck = (prompt: string): string => checkFirst(prompt)?.rest ?? prompt;

/** These instructions behind a command, or as they are without one. */
export const withCheck = (command: string | null | undefined, rest: string): string =>
  command?.trim() ? `${CHECK_MARK}${command.trim()}\n${rest}` : rest;
