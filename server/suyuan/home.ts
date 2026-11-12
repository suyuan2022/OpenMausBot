// suyuan fork: one bot, one conversation with the person. That conversation is the bot's home. Every other thread on the bot
// (work another bot sent over, a thread the bot opened on itself, a scheduled run) is a background run: the person can read
// it, and talks only at home. This file says which thread is home and keeps bots from closing it or working in it; the
// app's half is src/suyuan/home.ts.
import { mainThread } from "../main-thread.ts";

interface HomeCandidate {
  threadId: string;
  createdAt: number;
  askedAt?: number;
  archivedAt?: number;
  routineRunId?: string;
  openedBy?: unknown;
}

/** A bot's home: the conversation the person chose, while it is open; else upstream's rule among the threads no bot opened,
 * which for a bot the person has one conversation with is the thread made with the bot. Upstream alone would move the home
 * to a background run the person is reading, or once wrote in. Only a bot whose every open thread a bot opened falls back
 * on upstream's rule over all of them. */
export function homeThread(tasks: readonly HomeCandidate[], selectedId?: string, chosenId?: string): string | undefined {
  const open = (task: HomeCandidate) => !task.routineRunId && task.archivedAt === undefined;
  if (chosenId && tasks.some((task) => open(task) && task.threadId === chosenId)) return chosenId;
  const own = tasks.filter((task) => !task.openedBy);
  return mainThread(own.some(open) ? own : tasks, selectedId);
}

interface HomeStore {
  tasks(botId: string): readonly HomeCandidate[];
  bot(botId: string): { threadId: string; mainThreadChoice?: string } | null | undefined;
}

/** Whether this thread is its bot's home. A home may be a thread another bot once opened, when the person chose it. */
export function isHome(store: HomeStore, botId: string, threadId: string): boolean {
  const bot = store.bot(botId);
  return Boolean(bot) && homeThread(store.tasks(botId), bot!.threadId, bot!.mainThreadChoice) === threadId;
}

/** What a bot hears when it tries to close a teammate's home. */
export function homeStaysOpen(botName: string): string {
  return `that is ${botName}'s main conversation with the person, so it stays open — only work threads close`;
}

/** What a bot hears when it names a teammate's home as the thread to work in. */
export function homeTakesNoWork(botName: string): string {
  return `that is ${botName}'s main conversation with the person: it takes a one-way notice (reply "none"), never new work — leave thread out and the work gets its own thread`;
}
