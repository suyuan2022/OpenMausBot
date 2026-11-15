// suyuan fork: a thread a bot opened (start_thread on itself, coordinate_bots on a teammate) is a temporary job. Once it has
// sat idle for an hour it is closed and archived, so it leaves the thread list; its engine process has already gone by then
// (drivers/session-idle.ts closes it ten minutes after the last turn). Such a thread is not summarized while idle either
// (server/host/warm-summary-host.ts): nobody comes back to it, so the summary would be paid for and never read.
//
// Left alone: the bot's home, a pinned thread, a routine's run, a room lane, the durable "pair" thread between two bots, any
// thread the person wrote in (it is theirs now), one whose result they have not read yet or had in front of them within
// the hour (a thread opened for them to read there), and anything still busy or waiting (a running or queued turn, a
// question for the person, work handed to a teammate, a wait, an open card).
//
// The sweep works from saved timestamps (the newest message of each thread), never from timers armed at turn end, so a
// restart changes nothing. A message that later arrives in an archived thread brings it back: the turn that starts there
// clears the archive mark (reopenIdleArchived, called where server/index.ts clears closedBy).
import type { TaskClosedBy, WireMessage } from "../../shared/wire.ts";
import type { BotRecord, Message, Store, TaskRecord } from "../store.ts";
import { seenWithin } from "../thread-presence.ts";
import { isHome } from "./home.ts";

/** The closer's name on a thread this file archived. It is also how such a thread is told from one the person archived. */
export const IDLE_ARCHIVE_NAME = "闲置自动归档";
/** The activity line left in the thread. */
export const IDLE_ARCHIVE_LINE = "闲置超过时限，已自动归档";

const HOUR_MS = 60 * 60_000;
const FIVE_MINUTES_MS = 5 * 60_000;

function envMs(raw: string | undefined, fallback: number, min: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return value === 0 ? 0 : Math.max(min, Math.floor(value));
}

/** How long a bot-opened thread may sit idle: OMB_BOT_THREAD_ARCHIVE_MS, an hour by default; 0 turns the sweep off. */
export const idleArchiveAfterMs = (env: NodeJS.ProcessEnv = process.env): number => envMs(env.OMB_BOT_THREAD_ARCHIVE_MS, HOUR_MS, 1_000);
/** How often the sweep runs: OMB_BOT_THREAD_ARCHIVE_SWEEP_MS, five minutes by default. */
export const idleArchiveSweepMs = (env: NodeJS.ProcessEnv = process.env): number => envMs(env.OMB_BOT_THREAD_ARCHIVE_SWEEP_MS, FIVE_MINUTES_MS, 1_000) || FIVE_MINUTES_MS;
/** How long after the server starts the first sweep runs: OMB_BOT_THREAD_ARCHIVE_START_MS, five minutes by default. */
export const idleArchiveStartMs = (env: NodeJS.ProcessEnv = process.env): number => envMs(env.OMB_BOT_THREAD_ARCHIVE_START_MS, FIVE_MINUTES_MS, 1_000) || FIVE_MINUTES_MS;

type OpenedTask = Pick<TaskRecord, "openedBy" | "routineRunId">;
type SpokenLine = Pick<WireMessage, "role" | "kind" | "peerAsk" | "aside" | "relayed" | "via" | "automation">;

/** A one-to-one thread a bot opened as a job: on itself or a teammate ("new"), or a standing "work" thread. A room lane, the
 * durable "pair" thread and any kind this file does not know are not jobs that end. */
export function botOpenedJob(task: OpenedTask | undefined): boolean {
  const opener = task?.openedBy;
  if (!task || !opener?.botId || task.routineRunId || opener.roomLane) return false;
  return opener.kind === undefined || opener.kind === "work";
}

/** Whether the person wrote in this thread: a user line nobody else delivered. A teammate's ask (`peerAsk`, `aside`), a line
 * relayed from another app, an API call and an automation's line are not the person. */
export function personSpoke(messages: readonly SpokenLine[]): boolean {
  return messages.some((line) => line.role === "user" && line.kind === "text" && !line.peerAsk && !line.aside && !line.relayed && line.via !== "api" && !line.automation);
}

type JobStore = Pick<Store, "bot" | "tasks" | "taskByThread" | "messagesFor">;

/** A bot-opened job the person never wrote in, and not the bot's home: what the sweep may archive, and what is not
 * summarized while idle. */
export function unattendedBotJob(store: JobStore, botId: string, threadId: string): boolean {
  const task = store.taskByThread(botId, threadId);
  return botOpenedJob(task) && !isHome(store, botId, threadId) && !personSpoke(store.messagesFor(threadId));
}

/** Whether this file archived the thread (and nobody has unarchived it since). */
export function idleArchived(task: Pick<TaskRecord, "archivedAt" | "closedBy"> | undefined): boolean {
  return task?.archivedAt !== undefined && task.closedBy?.name === IDLE_ARCHIVE_NAME;
}

/** A card in the thread somebody can still answer. */
function openCard(messages: readonly Message[]): boolean {
  return messages.some((message) => {
    const card = message.card;
    if (card && !card.answered && !card.dismissed && !card.expired && !card.stopped) return true;
    const connector = message.connector;
    if (connector && !connector.resumed && !connector.superseded && !connector.stopped && !connector.dismissed) return true;
    const secret = message.secret;
    if (secret && !secret.resumed && !secret.superseded && !secret.stopped) return true;
    const signIn = message.signIn;
    return Boolean(signIn && !signIn.resumed && !signIn.superseded && !signIn.answeredInChat && !signIn.stopped);
  });
}

const lastActivityAt = (task: Pick<TaskRecord, "createdAt" | "updatedAt">, messages: readonly Message[]): number =>
  messages.reduce((latest, message) => Math.max(latest, message.at, message.turnCompletedAt ?? 0), Math.max(task.createdAt, task.updatedAt ?? 0));

const BUSY_ACTIVITY = new Set(["working", "waiting-on-you", "parked.computer", "no-signal"]);

export interface IdleArchiveDeps {
  store: JobStore & Pick<Store, "bots" | "appendMessage" | "patchTask" | "setTaskClosedBy">;
  /** A turn runs, is being set up or is queued in this thread. */
  busy(botId: string, threadId: string): boolean;
  /** Something will still wake this thread without the person: a question it asked, work it handed on or was handed, a wait. */
  waiting(botId: string, threadId: string): boolean;
  now?(): number;
  env?: NodeJS.ProcessEnv;
  log?(line: string): void;
}

/** Why this thread stays, or null when it is to be archived now. */
export function idleArchiveHold(deps: IdleArchiveDeps, bot: Pick<BotRecord, "id">, task: TaskRecord, now: number, afterMs: number): string | null {
  if (afterMs <= 0) return "the sweep is off";
  if (!botOpenedJob(task)) return "not a job a bot opened";
  if (task.archivedAt !== undefined) return "already archived";
  if (task.pinned === true) return "pinned";
  if (task.unread === true) return "the person has not read it";
  // The saved stamp first: most threads are settled here without reading their messages or asking who waits on what.
  if (now - Math.max(task.createdAt, task.updatedAt ?? 0) < afterMs) return "not idle long enough";
  if (isHome(deps.store, bot.id, task.threadId)) return "the bot's home";
  if (task.busy === true || (task.activity !== undefined && BUSY_ACTIVITY.has(task.activity)) || deps.busy(bot.id, task.threadId)) return "busy";
  if (deps.waiting(bot.id, task.threadId)) return "waiting";
  if (seenWithin(task.threadId, afterMs, now)) return "the person had it open within the hour";
  const messages = deps.store.messagesFor(task.threadId);
  if (now - lastActivityAt(task, messages) < afterMs) return "not idle long enough";
  if (personSpoke(messages)) return "the person wrote here";
  if (openCard(messages)) return "a card is open";
  return null;
}

/** One sweep: archives every bot-opened job that has sat idle long enough, and returns their thread ids. */
export function archiveIdleThreads(deps: IdleArchiveDeps): string[] {
  const now = (deps.now ?? Date.now)();
  const afterMs = idleArchiveAfterMs(deps.env);
  if (afterMs <= 0) return [];
  const archived: string[] = [];
  for (const bot of deps.store.bots) {
    if (bot.hidden) continue;
    for (const task of deps.store.tasks(bot.id).slice()) {
      try {
        if (idleArchiveHold(deps, bot, task, now, afterMs) !== null) continue;
        const opener = task.openedBy!;
        deps.store.appendMessage(task.threadId, { role: "bot", kind: "activity", tool: { name: IDLE_ARCHIVE_LINE, ok: true }, at: now });
        const closedBy: TaskClosedBy = { botId: task.closedBy?.botId ?? opener.botId, name: IDLE_ARCHIVE_NAME, at: now };
        deps.store.setTaskClosedBy(bot.id, task.threadId, closedBy);
        deps.store.patchTask(bot.id, task.threadId, { archivedAt: now });
        archived.push(task.threadId);
      } catch (error) {
        deps.log?.(`idle archive: skipped ${task.threadId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (archived.length) deps.log?.(`idle archive: archived ${archived.length} bot-opened thread(s) idle for over ${Math.round(afterMs / 60_000)} min`);
  return archived;
}

/** A turn starts in this thread: one this file archived comes back to the list. Call before closedBy is cleared. */
export function reopenIdleArchived(store: Pick<Store, "taskByThread" | "patchTask">, botId: string, threadId: string): void {
  if (idleArchived(store.taskByThread(botId, threadId))) store.patchTask(botId, threadId, { archivedAt: undefined });
}

/** Starts the sweep: first a while after the server came up, then on an interval. Off entirely when the threshold is 0. */
export function startIdleArchive(deps: IdleArchiveDeps): { stop(): void } {
  if (idleArchiveAfterMs(deps.env) <= 0) return { stop: () => undefined };
  let interval: ReturnType<typeof setInterval> | undefined;
  const sweep = () => {
    try {
      archiveIdleThreads(deps);
    } catch (error) {
      deps.log?.(`idle archive: sweep failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const first = setTimeout(() => {
    sweep();
    interval = setInterval(sweep, idleArchiveSweepMs(deps.env));
    interval.unref?.();
  }, idleArchiveStartMs(deps.env));
  first.unref?.();
  return { stop: () => { clearTimeout(first); if (interval) clearInterval(interval); } };
}
