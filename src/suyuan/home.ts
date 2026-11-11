// suyuan fork: one bot, one conversation with the person. With the thread list hidden (simple mode) that conversation is the
// bot's home, the thread the server names as mainThreadId (server/suyuan/home.ts). Every other thread on the bot is a
// background run: work another bot sent over, a thread the bot opened on itself, a scheduled run. A background run puts no
// dot on the bot, does not take the click on its tile and has no row in the lists, unless it waits on the person's approval
// or answer; opened from its chip it can be read, not written in. The app offers no other conversation either: no list of
// threads and no way to start one. With the thread list shown nothing here applies.

type Thread = { threadId?: string; activity?: string; openAsks?: number; routineRunId?: unknown };
type Owner = { threadId?: string; mainThreadId?: string; tasks?: ReadonlyArray<Thread> | null };

// What useShowThreads last returned in the app shell. It starts true, everything here off, so nothing changes until the app
// says the list is hidden: a test that never mounts the shell sees upstream's behaviour, whatever it mocks the mode to be.
let threadsShown = true;

/** useSuyuan calls this on every render of the app shell, before the sidebar and the chat below it render. */
export function noteThreadsShown(shown: boolean): void {
  threadsShown = shown;
}

/** useShowThreads outside a render, for the helpers that are handed a bot and nothing else. */
export function threadsShownNow(): boolean {
  return threadsShown;
}

/** Whether the app offers one conversation per bot and per room: no list of their threads, no way to start another.
 * Another subject gets a new group chat. */
export function oneConversation(): boolean {
  return !threadsShown;
}

/** The bot's home while the thread list is hidden and the bot still has that thread; undefined when the rule is off. */
export function homeOf(bot: Owner): string | undefined {
  const home = bot.mainThreadId;
  return !threadsShown && home && bot.tasks?.some((task) => task.threadId === home) ? home : undefined;
}

const waitsOnPerson = (task: Thread) => task.activity === "waiting-on-you" || (task.openAsks ?? 0) > 0;

/** The bot as its row, tile, dot and count see it: its home, and any thread that waits on the person. Scheduled runs stay,
 * upstream already keeps them out of every list. The same object comes back when nothing is left out. */
export function foreground<B extends Owner>(bot: B): B {
  const home = homeOf(bot);
  if (!home || !bot.tasks) return bot;
  const kept = bot.tasks.filter((task) => task.threadId === home || Boolean(task.routineRunId) || waitsOnPerson(task));
  return kept.length === bot.tasks.length ? bot : { ...bot, tasks: kept };
}

/** The threads a picker lists for a bot: with the thread list hidden, the home alone. */
export function listedThreads<T extends Thread>(bot: Owner | undefined, tasks: T[]): T[] {
  const home = bot ? homeOf(bot) : undefined;
  return home ? tasks.filter((task) => task.threadId === home) : tasks;
}

type Card = { requestId?: string; answered?: unknown; dismissed?: unknown; expired?: unknown };

/** A card in the thread that still waits on the person: an approval, or a question. */
const openCard = (message: { kind?: string; card?: Card | null }) =>
  message.kind === "options" && Boolean(message.card?.requestId) && !message.card?.answered && !message.card?.dismissed && !message.card?.expired;

/** Whether the thread on screen is a background run the person only reads: they write at home. While the run waits on
 * them it keeps its composer, which is where an approval is given and an answer typed; `messages` are the thread's. */
export function readsBackgroundRun(bot: Owner, messages: ReadonlyArray<{ kind?: string; card?: Card | null }> = []): boolean {
  const home = homeOf(bot);
  if (home === undefined || bot.threadId === home) return false;
  const onScreen = bot.tasks?.find((task) => task.threadId === bot.threadId);
  return !(onScreen && waitsOnPerson(onScreen)) && !messages.some(openCard);
}
