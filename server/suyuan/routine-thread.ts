// suyuan fork: a routine writes every run into one conversation instead of opening a new one each time.
import type { Routine, RoutineRun } from "../routines.ts";

export type RoutineThreadPick = {
  /** The conversation to write into; absent when the routine has none yet, so the run opens one. */
  threadId?: string;
  /** Another run is writing in that conversation right now: wait, never write two runs into it at once. */
  busy?: boolean;
  /** The routine should remember the conversation this run ends up in (its own new one, or one it adopted). */
  remember?: boolean;
};

type Alive = (botId: string, threadId: string) => boolean;

/** Only a routine that fires again and writes as a bot has a conversation worth keeping; a one-shot or a room goal does not. */
export function keepsOneThread(routine: Pick<Routine, "target" | "schedule">, run: Pick<RoutineRun, "target" | "eventSource">): boolean {
  // OMB_ROUTINE_ONE_THREAD=0 brings back a new conversation per run.
  return process.env.OMB_ROUTINE_ONE_THREAD !== "0" && routine.target === "bot" && run.target === "bot" && run.eventSource !== "wait" &&
    routine.schedule.type !== "once" && routine.schedule.type !== "limit_reset";
}

/** Gone or archived conversations are replaced; a routine from before this change adopts its latest run's conversation if that is still open. */
export function pickRoutineThread(routine: Routine, run: RoutineRun, runs: readonly RoutineRun[], alive: Alive): RoutineThreadPick {
  if (!keepsOneThread(routine, run)) return {};
  let threadId = routine.runThreadId;
  if (!threadId || !alive(run.botId, threadId)) {
    threadId = undefined;
    let latest: RoutineRun | undefined;
    for (const other of runs) {
      if (other.routineId !== routine.id || other.id === run.id || !other.threadId || other.botId !== run.botId) continue;
      if (other.threadId === routine.sourceThreadId || other.threadId === routine.resultsThreadId) continue;
      if (!latest || other.createdAt >= latest.createdAt) latest = other;
    }
    if (latest?.threadId && alive(run.botId, latest.threadId)) threadId = latest.threadId;
  }
  if (!threadId) return { remember: true };
  const holder = runs.find((other) => other.id !== run.id && other.routineId === routine.id && other.threadId === threadId &&
    ["running", "waiting"].includes(other.status));
  // A run waiting on an answer keeps the conversation as it is: this run goes to a conversation of its own.
  if (holder?.status === "waiting") return {};
  const remember = threadId !== routine.runThreadId;
  return holder ? { threadId, busy: true, remember } : { threadId, remember };
}

/** The pick for a run about to start, with the routine it belongs to; a run that already has a conversation keeps it. */
export function ownThread(routines: readonly Routine[], run: RoutineRun, runs: readonly RoutineRun[], alive: Alive | undefined): RoutineThreadPick & { routine?: Routine } {
  const routine = routines.find((candidate) => candidate.id === run.routineId);
  return !run.threadId && routine && alive ? { ...pickRoutineThread(routine, run, runs, alive), routine } : {};
}

/** Records the conversation the run ended up in: its own new one (named for the routine, not its first run's time), or the
 * one it adopted. A conversation joined some other way is not the routine's. */
export function rememberThread(own: RoutineThreadPick & { routine?: Routine }, threadId: string, joined: string | null): void {
  if (own.remember && own.routine && (own.threadId ? own.threadId === threadId : joined === null)) own.routine.runThreadId = threadId;
}

/** The earlier run in this conversation already left its report there, so carrying it in again would say it twice. */
export const continuesThread = (pick: RoutineThreadPick): boolean => pick.threadId !== undefined;

/** The conversation is marked as run `run`'s, replacing an earlier run of the same routine; one a person has taken over stays theirs. */
export function takesOverFrom(current: string | undefined, run: Pick<RoutineRun, "id" | "routineId">, runs: readonly RoutineRun[]): boolean {
  return current !== undefined && current !== run.id && runs.find((other) => other.id === current)?.routineId === run.routineId;
}
