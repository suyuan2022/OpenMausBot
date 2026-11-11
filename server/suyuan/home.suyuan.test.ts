// suyuan fork: which thread is a bot's home, and that no bot closes it.
import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "../config.ts";
import { createInternalThreadRoutes } from "../routes/internal-threads.ts";
import { Store, type BotRecord, type TaskRecord } from "../store.ts";
import { homeThread, isHome } from "./home.ts";

const thread = (threadId: string, createdAt: number, more: Record<string, unknown> = {}) => ({ threadId, createdAt, ...more });
const byBot = { openedBy: { botId: "chief", name: "Chief", kind: "work" } };

describe("homeThread", () => {
  it("is the thread made with the bot, for a bot whose other threads bots opened", () => {
    expect(homeThread([thread("work", 1, byBot), thread("first", 2), thread("work-2", 3, byBot)])).toBe("first");
  });

  it("does not move to a thread a bot opened, on screen or once written in", () => {
    const tasks = [thread("first", 1), thread("work", 2, { ...byBot, askedAt: 50 })];
    expect(homeThread(tasks, "work")).toBe("first");
    expect(homeThread([thread("first", 1, { askedAt: 10 }), thread("work", 2, { ...byBot, askedAt: 50 })], "work")).toBe("first");
  });

  it("keeps upstream's rule among the person's own threads: the one last written in, else the one on screen, else the oldest", () => {
    const tasks = [thread("first", 1, { askedAt: 10 }), thread("later", 3, { askedAt: 90 }), thread("work", 4, byBot)];
    expect(homeThread(tasks, "first")).toBe("later");
    expect(homeThread([thread("first", 1), thread("later", 3)], "later")).toBe("later");
    expect(homeThread([thread("first", 1), thread("later", 3)], "work")).toBe("first");
  });

  it("is the person's choice while that thread is open, a thread a bot opened included", () => {
    const tasks = [thread("first", 1), thread("work", 2, byBot)];
    expect(homeThread(tasks, "first", "work")).toBe("work");
    expect(homeThread([thread("first", 1), thread("work", 2, { ...byBot, archivedAt: 9 })], "first", "work")).toBe("first");
    expect(homeThread(tasks, "first", "gone")).toBe("first");
  });

  it("never picks a scheduled run or an archived thread, and falls back on upstream's rule when every open thread is a bot's", () => {
    expect(homeThread([thread("run", 1, { routineRunId: "r" }), thread("old", 2, { archivedAt: 5 }), thread("mine", 3)])).toBe("mine");
    expect(homeThread([thread("work-a", 1, byBot), thread("work-b", 2, { ...byBot, askedAt: 7 })], "work-a")).toBe("work-b");
  });
});

const selection = () => ({ instanceId: "claude", model: "claude-sonnet-5" });
beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));

/** A real Store: Chief opened two threads on Maus, and the person chose one of them as Maus's home. */
function fixture() {
  const store = new Store(selection);
  const chief = store.createBot({ name: "Chief", section: "Work" });
  const maus = store.createBot({ name: "Maus", section: "Work" });
  const opened = (title: string): TaskRecord =>
    store.createTask(maus.id, title, false, undefined, { botId: chief.id, name: chief.name, kind: "work", threadId: chief.threadId, at: 1 })!;
  const adopted = opened("adopted"), work = opened("work");
  const close = async (from: BotRecord, threadId: string) => {
    const route = createInternalThreadRoutes({
      store, coordinator: { awaitingAnswer: () => false, parkedDirect: () => undefined, activeDirect: () => undefined, active: () => [] } as never,
      from, fromThreadId: from.threadId, ownsThread: () => true, shown: () => true,
      threadBusy: () => false, queuedThreadPosition: () => null, queuedReason: () => "",
    });
    let out: { status: number; body: Record<string, unknown> } | undefined;
    const path = `/api/internal/threads/${threadId}/close`;
    await route({ res: {}, path, method: "POST", url: new URL(`http://x${path}`), json: (_res: unknown, status: number, body: never) => { out = { status, body }; } } as never);
    return out ?? { status: 0, body: {} };
  };
  return { store, chief, maus, adopted, work, close };
}

describe("a bot's home stays open", () => {
  it("isHome follows the bot's own first thread until the person chooses another", () => {
    const { store, maus, adopted } = fixture();
    expect(isHome(store, maus.id, maus.threadId)).toBe(true);
    expect(isHome(store, maus.id, adopted.threadId)).toBe(false);
    store.patchBot(maus.id, { mainThreadChoice: adopted.threadId });
    expect(isHome(store, maus.id, adopted.threadId)).toBe(true);
    expect(isHome(store, maus.id, maus.threadId)).toBe(false);
    expect(isHome(store, "nobody", maus.threadId)).toBe(false);
  });

  it("close_thread refuses the home, even to the bot that opened it, and still closes a work thread", async () => {
    const { store, chief, maus, adopted, work, close } = fixture();
    store.patchBot(maus.id, { mainThreadChoice: adopted.threadId });
    const refused = await close(chief, adopted.threadId);
    expect(refused.status).toBe(409);
    expect(String(refused.body.error)).toContain("Maus's main conversation with the person");
    expect(store.taskByThread(maus.id, adopted.threadId)?.closedBy).toBeUndefined();

    const closed = await close(chief, work.threadId);
    expect(closed.status).toBe(200);
    expect(store.taskByThread(maus.id, work.threadId)?.closedBy?.botId).toBe(chief.id);
  });
});
