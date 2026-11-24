// suyuan fork (FORK.md): what the person has read, said once. A line in the inbox (server/host/place-inbox.ts) that came from
// a background run (work another bot passed on, a thread a bot opened on itself, a scheduled run) is read when the person
// reads the conversation that run reports to: the opener's conversation, up to a home. Upstream marks a line read only when
// its own thread is opened, and in Simple mode the person never opens a background run.
import { homeThread, isHome } from "./home.ts";

interface ReadStore {
  botByThread(threadId: string): { id: string } | null | undefined;
  bot(botId: string): { threadId: string; mainThreadChoice?: string } | null | undefined;
  tasks(botId: string): ReadonlyArray<{ threadId: string; createdAt: number; askedAt?: number; archivedAt?: number; routineRunId?: string; openedBy?: { threadId?: string } }>;
}

/** Runs reach a home in a few steps; a loop in the openers' chain stops here. */
const MAX_STEPS = 8;

/** The conversation a background run reports to: the thread that handed it over (the live handoff first, then the bot that
 * opened it), or for a scheduled run its bot's home. Null for a home, and for a thread nobody opened. */
export function reportsTo(store: ReadStore, threadId: string, assigner: (threadId: string) => string | null): string | null {
  const bot = store.botByThread(threadId);
  if (!bot || isHome(store, bot.id, threadId)) return null;
  const task = store.tasks(bot.id).find((one) => one.threadId === threadId);
  if (!task) return null;
  const opener = assigner(threadId) ?? task.openedBy?.threadId;
  if (opener && opener !== threadId) return opener;
  if (!task.routineRunId) return null;
  const owner = store.bot(bot.id);
  return owner ? homeThread(store.tasks(bot.id), owner.threadId, owner.mainThreadChoice) ?? null : null;
}

/** Whether reading `opened` reads a line from `lineThread`: it is that thread, or a run reporting to it, however deep. */
export function readsWith(store: ReadStore, lineThread: string, opened: string, assigner: (threadId: string) => string | null): boolean {
  let at: string | null = lineThread;
  for (let step = 0; at && step <= MAX_STEPS; step++) {
    if (at === opened) return true;
    at = reportsTo(store, at, assigner);
  }
  return false;
}
