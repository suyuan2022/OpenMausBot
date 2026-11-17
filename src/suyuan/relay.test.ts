import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/state/thread-navigation", () => ({ openBot: vi.fn(), openBotThread: vi.fn() }));

import { openBot, openBotThread } from "@/state/thread-navigation";
import type { Bot } from "@/state/store";
import { noteThreadsShown } from "./home";
import { backFrom, escapeGoesBack, goBack, passedOnBy } from "./relay";

// 荔枝 passed the person's words to shopping in a thread she opened from her own conversation.
const lizhi = { id: "lizhi", threadId: "lz-home", mainThreadId: "lz-home", tasks: [{ threadId: "lz-home" }, { threadId: "lz-other" }] };
const shopping = {
  id: "shopping",
  threadId: "jd",
  mainThreadId: "sh-home",
  tasks: [{ threadId: "sh-home" }, { threadId: "jd", openedBy: { botId: "lizhi", name: "荔枝", threadId: "lz-home" } }],
};
const onThread = <T extends { tasks: Array<{ threadId: string; openedBy?: object }> }>(bot: T, threadId: string, openedBy?: object) =>
  ({ ...bot, threadId, tasks: bot.tasks.map((task) => (task.threadId === threadId ? { ...task, openedBy } : task)) });

afterEach(() => {
  noteThreadsShown(true);
  vi.clearAllMocks();
});

describe("a run another bot passed on", () => {
  it("names the bot that passed it on, while the app offers one conversation per bot", () => {
    noteThreadsShown(false);
    expect(passedOnBy(shopping)).toEqual({ botId: "lizhi", name: "荔枝", threadId: "lz-home" });
  });

  it("names nobody on the bot's own conversation, on a run it opened itself, or with the thread list shown", () => {
    noteThreadsShown(false);
    expect(passedOnBy({ ...shopping, threadId: "sh-home" })).toBeNull();
    expect(passedOnBy(onThread(shopping, "jd", { botId: "shopping", name: "shopping" }))).toBeNull();
    noteThreadsShown(true);
    expect(passedOnBy(shopping)).toBeNull();
  });

  it("names nobody on a home another bot once opened: 深度研究's home began as a thread 荔枝 opened on it", () => {
    noteThreadsShown(false);
    const research = { ...shopping, mainThreadId: "jd" };
    expect(passedOnBy(research)).toBeNull();
    expect(backFrom(research, [lizhi, research])).toEqual({ bot: research });
  });

  it("goes back to the passing bot's conversation it came from", () => {
    noteThreadsShown(false);
    expect(backFrom(shopping, [lizhi, shopping])).toEqual({ bot: lizhi });
    const fromOther = onThread(shopping, "jd", { botId: "lizhi", name: "荔枝", threadId: "lz-other" });
    expect(backFrom(fromOther, [lizhi, fromOther])).toEqual({ bot: lizhi, threadId: "lz-other" });
  });

  it("goes back to the passing bot when its thread is gone, and to this bot's own conversation when that bot is gone", () => {
    noteThreadsShown(false);
    const gone = onThread(shopping, "jd", { botId: "lizhi", name: "荔枝", threadId: "closed" });
    expect(backFrom(gone, [lizhi, gone])).toEqual({ bot: lizhi });
    expect(backFrom(shopping, [shopping])).toEqual({ bot: shopping });
  });

  it("opens the passing bot's home as the bot, and any other of its threads as that thread", () => {
    noteThreadsShown(false);
    const dispatch = vi.fn();
    goBack(dispatch, shopping as unknown as Bot, [lizhi, shopping] as unknown as Bot[]);
    expect(openBot).toHaveBeenCalledWith(dispatch, lizhi, false);
    const fromOther = onThread(shopping, "jd", { botId: "lizhi", name: "荔枝", threadId: "lz-other" });
    goBack(dispatch, fromOther as unknown as Bot, [lizhi, fromOther] as unknown as Bot[]);
    expect(openBotThread).toHaveBeenCalledWith(dispatch, lizhi, "lz-other", false);
  });
});

describe("Esc on a background run", () => {
  const key = (patch: Partial<KeyboardEvent> = {}) =>
    ({ key: "Escape", defaultPrevented: false, isComposing: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, target: null, ...patch }) as KeyboardEvent;
  const page = (open: boolean) => ({ querySelector: () => (open ? ({} as Element) : null) });

  it("goes back on a bare Escape", () => {
    expect(escapeGoesBack(key(), page(false))).toBe(true);
  });

  it("leaves Escape to a dialog or menu, a field being typed in, an IME, and every other key", () => {
    expect(escapeGoesBack(key(), page(true))).toBe(false);
    expect(escapeGoesBack(key({ target: { tagName: "TEXTAREA" } as unknown as EventTarget }), page(false))).toBe(false);
    expect(escapeGoesBack(key({ target: { tagName: "DIV", isContentEditable: true } as unknown as EventTarget }), page(false))).toBe(false);
    expect(escapeGoesBack(key({ isComposing: true }), page(false))).toBe(false);
    expect(escapeGoesBack(key({ defaultPrevented: true }), page(false))).toBe(false);
    expect(escapeGoesBack(key({ metaKey: true }), page(false))).toBe(false);
    expect(escapeGoesBack(key({ key: "Backspace" }), page(false))).toBe(false);
  });
});
