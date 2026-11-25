// suyuan fork (slim one-home): with the thread list hidden, unread badges/dots and navigation focus on the bot's
// home and anything waiting on the person, and the app offers no new/switch thread controls in Simple mode.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { placeOf, subjectOf } from "@/components/inbox/inbox-view";
import { botShowsUnread, botUnreadCount } from "@/lib/bot-unread";
import { t } from "@/lib/i18n";
import { markedThread } from "@/state/thread-navigation";
import type { Bot } from "@/state/store";
import { foreground, homeOf, listedThreads, noteHomes, noteThreadsShown, oneConversation, threadsShownNow } from "./home";

type Thread = NonNullable<Bot["tasks"]>[number];
const home: Thread = { threadId: "home", title: "Home", createdAt: 1 };
const thread = (threadId: string, more: Partial<Thread> = {}): Thread => ({ threadId, title: threadId, createdAt: 2, ...more });
/** Lizhi, at home, with these threads beside it. */
const lizhi = (beside: Thread[], more: Partial<Bot> = {}) =>
  ({ id: "lizhi", name: "Lizhi", threadId: "home", mainThreadId: "home", tasks: [home, ...beside], ...more }) as Bot;
const ids = (tasks: ReadonlyArray<{ threadId?: string }> | null | undefined) => (tasks ?? []).map((task) => task.threadId);

// The app shell tells the fork whether the thread list is shown (useSuyuan); these tests stand in for it. Simple mode hides it.
beforeEach(() => noteThreadsShown(false));
afterEach(() => noteThreadsShown(true));

describe("which threads a bot shows for", () => {
  const working = thread("work", { busy: true, activity: "working", openedBy: { botId: "chief", name: "Chief" } as never });
  const replied = thread("reply", { unread: true });
  const approval = thread("approval", { activity: "waiting-on-you" });
  const asking = thread("asking", { openAsks: 1 });
  const run = thread("run", { routineRunId: "r1", busy: true });

  it("keeps the home, what waits on the person, and scheduled runs; drops work and replies in background runs", () => {
    expect(ids(foreground(lizhi([working, replied, approval, asking, run])).tasks)).toEqual(["home", "approval", "asking", "run"]);
  });

  it("leaves the bot alone without a home, or when the home is not among its threads", () => {
    const bot = lizhi([working, replied]);
    const homeless = { ...bot, mainThreadId: undefined }, gone = { ...bot, mainThreadId: "elsewhere" };
    expect(foreground(homeless)).toBe(homeless);
    expect(foreground(gone)).toBe(gone);
    expect(homeOf(gone)).toBeUndefined();
  });

  it("hands back the same bot when nothing is left out, so a memoised row does not redraw", () => {
    const bot = lizhi([approval]);
    expect(foreground(bot)).toBe(bot);
  });

  it("stays off until the app says the thread list is hidden, so a test that never mounts the app sees upstream", () => {
    noteThreadsShown(true);
    expect(threadsShownNow()).toBe(true);
    const bot = lizhi([working, replied]);
    expect(foreground(bot)).toBe(bot);
    expect(botShowsUnread(bot)).toBe(true);
    expect(markedThread(bot, false)).toBe("reply");
  });
});

describe("a background run, in simple mode", () => {
  const working = thread("work", { busy: true, activity: "working" }), replied = thread("reply", { unread: true });

  it("puts no dot and no count on the bot, and ignores non-waiting background work", () => {
    const bot = lizhi([working, replied]);
    expect(botShowsUnread(bot)).toBe(false);
    expect(botUnreadCount(bot)).toBe(0);
    expect(markedThread(bot, false)).toBeNull();
  });

  it("still shows when it waits on an approval or an answer", () => {
    const bot = lizhi([working, thread("approval", { activity: "waiting-on-you", unread: true })]);
    expect(botShowsUnread(bot)).toBe(true);
    expect(markedThread(bot, false)).toBe("approval");
    expect(botUnreadCount(lizhi([thread("asking", { openAsks: 2 })]))).toBe(2);
  });

  it("leaves the home's own dot, count and work as they were", () => {
    const bot = lizhi([working], { tasks: [{ ...home, unread: true, busy: true }, working] });
    expect(botShowsUnread(bot)).toBe(true);
    expect(botUnreadCount(bot)).toBe(1);
    expect(markedThread(bot, false)).toBe("home");
  });
});

describe("one conversation per bot and room", () => {
  it("is on with the thread list hidden and off with it shown", () => {
    expect(oneConversation()).toBe(true);
    noteThreadsShown(true);
    expect(oneConversation()).toBe(false);
  });

  it("lists the home alone where a thread is picked, and every thread with the list shown or for a bot without a home", () => {
    const bot = lizhi([thread("work"), thread("reply")]);
    expect(ids(listedThreads(bot, bot.tasks!))).toEqual(["home"]);
    expect(ids(listedThreads({ ...bot, mainThreadId: undefined }, bot.tasks!))).toEqual(["home", "work", "reply"]);
    expect(ids(listedThreads(undefined, bot.tasks!))).toEqual(["home", "work", "reply"]);
    noteThreadsShown(true);
    expect(ids(listedThreads(bot, bot.tasks!))).toEqual(["home", "work", "reply"]);
  });
});

describe("an inbox line from a bot's one conversation", () => {
  const bots = [lizhi([])];
  const row = (kind: "message" | "result", threadId: string) => ({ kind, origin: { botId: "lizhi", threadId, title: "你看一下今天的时间应该要去挂号了吧" } }) as never;

  it("does not name the conversation it came from, which is the bot's only one", () => {
    noteHomes(bots);
    expect(placeOf(row("result", "home"))).toBeNull();
    expect(subjectOf(row("message", "home"))).toBe(t("inbox.subject.message"));
  });

  it("still names a background run, and every conversation with the thread list shown", () => {
    noteHomes(bots);
    expect(placeOf(row("result", "run"))).toBe(t("inbox.in", { title: "你看一下今天的时间应该要去挂号了吧" }));
    noteThreadsShown(true);
    expect(placeOf(row("result", "home"))).not.toBeNull();
  });
});
