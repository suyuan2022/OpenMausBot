// suyuan fork: with the thread list hidden, a bot's row, dot, count and click see its home and what waits on the person.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { botShowsUnread, botUnreadCount } from "@/lib/bot-unread";
import { sidebarBotActivityTasks, sidebarBotStatus, threadsWaitingOnPerson } from "@/components/SidebarBotActivity";
import { markedThread, openBotRow } from "@/state/thread-navigation";
import type { Bot } from "@/state/store";
import { foreground, homeOf, noteThreadsShown, readsBackgroundRun, threadsShownNow } from "./home";
import { busyInOwnChats } from "./own-work";

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
    expect(ids(foreground(lizhi([working, replied, approval, asking, run]), false).tasks)).toEqual(["home", "approval", "asking", "run"]);
  });

  it("leaves the bot alone with the thread list shown, without a home, or when the home is not among its threads", () => {
    const bot = lizhi([working, replied]);
    expect(foreground(bot, true)).toBe(bot);
    const homeless = { ...bot, mainThreadId: undefined }, gone = { ...bot, mainThreadId: "elsewhere" };
    expect(foreground(homeless, false)).toBe(homeless);
    expect(foreground(gone, false)).toBe(gone);
    expect(homeOf(gone, false)).toBeUndefined();
  });

  it("hands back the same bot when nothing is left out, so a memoised row does not redraw", () => {
    const bot = lizhi([approval]);
    expect(foreground(bot, false)).toBe(bot);
  });

  it("stays off until the app says the thread list is hidden, so a test that never mounts the app sees upstream", () => {
    noteThreadsShown(true);
    expect(threadsShownNow()).toBe(true);
    const bot = lizhi([working, replied]);
    expect(botShowsUnread(bot)).toBe(true);
    expect(ids(sidebarBotActivityTasks(bot, {}))).toEqual(["work", "reply"]);
  });
});

describe("a background run, in simple mode", () => {
  const working = thread("work", { busy: true, activity: "working" }), replied = thread("reply", { unread: true });

  it("puts no dot and no count on the bot, and its work does not show on the row", () => {
    const bot = lizhi([working, replied]);
    expect(botShowsUnread(bot)).toBe(false);
    expect(botUnreadCount(bot)).toBe(0);
    expect(busyInOwnChats(bot)).toBe(false);
    expect(sidebarBotStatus(bot, {})).toMatchObject({ waiting: false, working: false });
    expect(sidebarBotActivityTasks(bot, {})).toEqual([]);
    expect(threadsWaitingOnPerson(bot, {})).toEqual([]);
  });

  it("does not take the click on the bot", () => {
    const bot = lizhi([working, replied]);
    expect(markedThread(bot, false)).toBeNull();
    const dispatch = vi.fn();
    openBotRow(dispatch, bot, false, false);
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([{ type: "select", id: "lizhi" }]);
  });

  it("still shows and takes the click once it waits on an approval or an answer", () => {
    const bot = lizhi([working, thread("approval", { activity: "waiting-on-you", unread: true })]);
    expect(botShowsUnread(bot)).toBe(true);
    expect(sidebarBotStatus(bot, {}).waiting).toBe(true);
    expect(ids(threadsWaitingOnPerson(bot, {}))).toEqual(["approval"]);
    expect(markedThread(bot, false)).toBe("approval");
    expect(botUnreadCount(lizhi([thread("asking", { openAsks: 2 })]))).toBe(2);
  });

  it("leaves the home's own dot, count and work as they were", () => {
    const bot = lizhi([working], { tasks: [{ ...home, unread: true, busy: true }, working] });
    expect(botShowsUnread(bot)).toBe(true);
    expect(botUnreadCount(bot)).toBe(1);
    expect(busyInOwnChats(bot)).toBe(true);
    expect(markedThread(bot, false)).toBe("home");
  });

  it("is read, not written in: any thread on screen that is not the home", () => {
    expect(readsBackgroundRun(lizhi([working]), false)).toBe(false);
    expect(readsBackgroundRun(lizhi([working], { threadId: "work" }), false)).toBe(true);
    expect(readsBackgroundRun(lizhi([thread("run", { routineRunId: "r1" })], { threadId: "run" }), false)).toBe(true);
    expect(readsBackgroundRun(lizhi([working], { threadId: "work" }), true)).toBe(false);
    expect(readsBackgroundRun(lizhi([working], { threadId: "work", mainThreadId: undefined }), false)).toBe(false);
  });

  it("keeps its composer while it waits on the person: that is where an approval is given and an answer typed", () => {
    const asking = thread("work", { busy: true, activity: "waiting-on-you" });
    expect(readsBackgroundRun(lizhi([asking], { threadId: "work" }), false)).toBe(false);
    expect(readsBackgroundRun(lizhi([thread("work", { openAsks: 1 })], { threadId: "work" }), false)).toBe(false);
    // A question left by a turn that has ended: the thread is idle, the open card is the only sign.
    const idle = lizhi([thread("work")], { threadId: "work" });
    const card = (more: Record<string, unknown> = {}) => [{ kind: "text" }, { kind: "options", card: { requestId: "needs-input-1", ...more } }];
    expect(readsBackgroundRun(idle, false, card())).toBe(false);
    for (const settled of [{ answered: "answer" }, { dismissed: true }, { expired: true }]) expect(readsBackgroundRun(idle, false, card(settled))).toBe(true);
    expect(readsBackgroundRun(idle, false, [{ kind: "options", card: {} }])).toBe(true);
  });
});

describe("with the thread list shown", () => {
  it("every thread counts, as upstream has it", () => {
    noteThreadsShown(true);
    const bot = lizhi([thread("work", { busy: true }), thread("reply", { unread: true })]);
    expect(botShowsUnread(bot)).toBe(true);
    expect(busyInOwnChats(bot)).toBe(true);
    expect(ids(sidebarBotActivityTasks(bot, {}))).toEqual(["work", "reply"]);
    expect(markedThread(bot, true)).toBe("reply");
  });
});
