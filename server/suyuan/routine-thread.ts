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

/** What writes into one conversation: a routine that fires again, or the webhook / app trigger behind an event run (which has no
 * routine of its own, only a trigger id that every one of its runs carries). A one-shot or a room goal does not. */
export function keepsOneThread(routine: Pick<Routine, "target" | "schedule"> | undefined, run: Pick<RoutineRun, "target" | "eventSource" | "webhookId">): boolean {
  // OMB_ROUTINE_ONE_THREAD=0 brings back a new conversation per run; a Cloud server (OMB_CLOUD_ROLE) keeps upstream's, which
  // keeps each run's author and audience apart.
  if (process.env.OMB_ROUTINE_ONE_THREAD === "0" || process.env.OMB_CLOUD_ROLE || run.target !== "bot" || run.eventSource === "wait") return false;
  return routine ? routine.target === "bot" && routine.schedule.type !== "once" && routine.schedule.type !== "limit_reset" : run.webhookId !== undefined;
}

/** A routine's pointer decides while it is set: once that conversation is gone or archived the run opens a new one, and does not
 * fall back to some other conversation of an earlier run. Only a routine from before this change (no pointer) and an event trigger
 * (never has one) take the conversation of their latest run, when it is still open. */
export function pickRoutineThread(routine: Routine | undefined, run: RoutineRun, runs: readonly RoutineRun[], alive: Alive): RoutineThreadPick {
  if (!keepsOneThread(routine, run)) return {};
  let threadId = routine?.runThreadId;
  if (threadId !== undefined && !alive(run.botId, threadId)) threadId = undefined;
  else if (threadId === undefined) {
    let latest: RoutineRun | undefined;
    for (const other of runs) {
      if (other.routineId !== run.routineId || other.id === run.id || !other.threadId || other.botId !== run.botId) continue;
      if (other.threadId === routine?.sourceThreadId || other.threadId === (routine ?? run).resultsThreadId) continue;
      if (!latest || other.createdAt >= latest.createdAt) latest = other;
    }
    if (latest?.threadId && alive(run.botId, latest.threadId)) threadId = latest.threadId;
  }
  if (!threadId) return { remember: true };
  const holder = runs.find((other) => other.id !== run.id && other.routineId === run.routineId && other.threadId === threadId &&
    ["running", "waiting"].includes(other.status));
  // A run waiting on an answer keeps the conversation as it is: this run goes to a conversation of its own.
  if (holder?.status === "waiting") return {};
  const remember = threadId !== routine?.runThreadId;
  return holder ? { threadId, busy: true, remember } : { threadId, remember };
}

/** The pick for a run about to start, with the routine it belongs to; a run that already has a conversation keeps it. */
export function ownThread(routines: readonly Routine[], run: RoutineRun, runs: readonly RoutineRun[], alive: Alive | undefined): RoutineThreadPick & { routine?: Routine } {
  const routine = routines.find((candidate) => candidate.id === run.routineId);
  return !run.threadId && alive ? { ...pickRoutineThread(routine, run, runs, alive), routine } : {};
}

/** Records the conversation the run ended up in: its own new one (named for the routine, not its first run's time), or the
 * one it adopted. A conversation joined some other way is not the routine's. */
export function rememberThread(own: RoutineThreadPick & { routine?: Routine }, threadId: string, joined: string | null): void {
  if (own.remember && own.routine && (own.threadId ? own.threadId === threadId : joined === null)) own.routine.runThreadId = threadId;
}

/** Continuity's report, unless the run it came from is in this very conversation, where it is already in the context: then
 * carrying it again would say it twice. A report from another conversation is not in the context and still goes in. */
export function carryOutside<T extends { finishedAt: number }>(own: RoutineThreadPick, run: RoutineRun, runs: readonly RoutineRun[], carry: T | null): T | null {
  if (!carry || own.threadId === undefined) return carry;
  const from = runs.find((other) => other.id !== run.id && other.routineId === run.routineId && other.status === "completed" &&
    Boolean(other.output?.trim()) && (other.finishedAt ?? other.createdAt) === carry.finishedAt);
  return from?.threadId === own.threadId ? null : carry;
}

/** The conversation is marked as run `run`'s, replacing an earlier run of the same routine; one a person has taken over stays theirs. */
export function takesOverFrom(current: string | undefined, run: Pick<RoutineRun, "id" | "routineId">, runs: readonly RoutineRun[]): boolean {
  return current !== undefined && current !== run.id && runs.find((other) => other.id === current)?.routineId === run.routineId;
}
