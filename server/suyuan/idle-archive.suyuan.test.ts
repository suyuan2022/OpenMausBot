// suyuan fork: a thread a bot opened is archived once it has sat idle for an hour, comes back when a turn starts in it, and
// is not summarized while idle.
import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DATA_DIR } from "../config.ts";
import { workThreadFor } from "../host/work-thread.ts";
import { Store, type TaskRecord } from "../store.ts";
import {
  archiveIdleThreads, botOpenedJob, IDLE_ARCHIVE_LINE, IDLE_ARCHIVE_NAME, idleArchiveAfterMs, idleArchived, idleArchiveHold, idleArchiveStartMs,
  idleArchiveSweepMs, personSpoke, reopenIdleArchived, startIdleArchive, unattendedBotJob, type IdleArchiveDeps,
} from "./idle-archive.ts";

const MINUTE = 60_000, HOUR = 60 * MINUTE;
const selection = () => ({ instanceId: "claude", model: "claude-sonnet-5" });
beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));
afterEach(() => vi.useRealTimers());

/** A real Store: Maus has its home, a thread it opened on itself, a thread Chief opened on it, Chief's standing work thread,
 * and threads the sweep must leave alone. The clock starts when they were made and is moved by `later`. */
function fixture(env: NodeJS.ProcessEnv = {}) {
  rmSync(DATA_DIR, { recursive: true, force: true });
  const store = new Store(selection);
  const chief = store.createBot({ name: "Chief", section: "Work" });
  const maus = store.createBot({ name: "Maus", section: "Work" });
  const made = Date.now();
  const self = store.createTask(maus.id, "self", false, undefined, { botId: maus.id, name: maus.name, at: made })!;
  const fresh = store.createTask(maus.id, "new", false, undefined, { botId: chief.id, name: chief.name, threadId: chief.threadId, at: made })!;
  const work = store.createTask(maus.id, "@Chief · work", false, undefined, { botId: chief.id, name: chief.name, kind: "work", threadId: chief.threadId, at: made })!;
  const pair = store.createTask(maus.id, "pair", false, undefined, { botId: chief.id, name: chief.name, kind: "pair", at: made })!;
  const lane = store.createTask(maus.id, "lane", false, undefined, { botId: chief.id, name: chief.name, threadId: "room", roomLane: true, at: made })!;
  const run = store.createTask(maus.id, "run", false, undefined, { botId: maus.id, name: maus.name, at: made })!;
  store.patchTask(maus.id, run.threadId, { routineRunId: "routine-run" });
  const own = store.createTask(maus.id, "the person's", false)!;
  let now = made + 1;
  const busy = new Set<string>(), waiting = new Set<string>(), log: string[] = [];
  const deps: IdleArchiveDeps = { store, busy: (_bot, id) => busy.has(id), waiting: (_bot, id) => waiting.has(id), now: () => now, env, log: (line) => log.push(line) };
  const task = (thread: TaskRecord) => store.taskByThread(maus.id, thread.threadId)!;
  return {
    store, chief, maus, self, fresh, work, pair, lane, run, own, deps, busy, waiting, log, task,
    later: (ms: number) => { now += ms; return now; },
    now: () => now,
    sweep: () => archiveIdleThreads(deps),
    hold: (thread: TaskRecord) => idleArchiveHold(deps, maus, task(thread), now, idleArchiveAfterMs(env)),
  };
}

describe("which threads are a bot's jobs", () => {
  it("counts a thread opened on itself, one opened on a teammate and a standing work thread; not a pair, a lane, a routine run or the person's", () => {
    const f = fixture();
    expect([f.self, f.fresh, f.work].map(botOpenedJob)).toEqual([true, true, true]);
    expect([f.pair, f.lane, f.task(f.run), f.own, undefined].map(botOpenedJob)).toEqual([false, false, false, false, false]);
    expect(botOpenedJob({ openedBy: { botId: "b", name: "B", kind: "later" as never, at: 1 } })).toBe(false);
  });

  it("takes only a line the person typed as the person's: not a teammate's ask, a relayed line, an API call or an automation's", () => {
    const line = (more: Record<string, unknown> = {}) => ({ role: "user" as const, kind: "text" as const, ...more });
    expect(personSpoke([line()] as never)).toBe(true);
    expect(personSpoke([line({ peerAsk: { botId: "b", name: "B" } }), line({ aside: true }), line({ relayed: true }), line({ via: "api" }),
      line({ automation: { kind: "routine" } }), { role: "bot", kind: "text" }, { role: "user", kind: "activity" }] as never)).toBe(false);
  });
});

describe("the idle sweep", () => {
  it("leaves every thread alone before the hour is up", () => {
    const f = fixture();
    f.later(59 * MINUTE);
    expect(f.sweep()).toEqual([]);
    expect(f.hold(f.self)).toBe("not idle long enough");
    expect(f.task(f.self).archivedAt).toBeUndefined();
  });

  it("closes and archives the three kinds of job after an hour, and nothing else", () => {
    const f = fixture();
    f.store.patchTask(f.maus.id, f.self.threadId, { unread: true });
    const at = f.later(HOUR + MINUTE);
    expect(f.sweep().sort()).toEqual([f.self.threadId, f.fresh.threadId, f.work.threadId].sort());
    for (const thread of [f.self, f.fresh, f.work]) {
      const task = f.task(thread);
      expect(task.archivedAt).toBe(at);
      expect(task.closedBy).toEqual({ botId: thread.openedBy!.botId, name: IDLE_ARCHIVE_NAME, at });
      expect(idleArchived(task)).toBe(true);
      expect(f.store.messagesFor(thread.threadId).at(-1)).toMatchObject({ role: "bot", kind: "activity", tool: { name: IDLE_ARCHIVE_LINE, ok: true } });
    }
    expect(f.task(f.self).unread).toBeFalsy();
    for (const thread of [f.pair, f.lane, f.run, f.own]) expect(f.task(thread).archivedAt).toBeUndefined();
    expect(f.store.taskByThread(f.maus.id, f.maus.threadId)?.archivedAt).toBeUndefined();
    expect(f.store.taskByThread(f.chief.id, f.chief.threadId)?.archivedAt).toBeUndefined();
    expect(f.log).toEqual(["idle archive: archived 3 bot-opened thread(s) idle for over 60 min"]);
  });

  it("does not archive twice, and archives a work thread its opener already closed", () => {
    const f = fixture();
    f.store.setTaskClosedBy(f.maus.id, f.work.threadId, { botId: f.chief.id, name: f.chief.name, at: f.now() });
    f.later(HOUR + MINUTE);
    expect(f.sweep()).toContain(f.work.threadId);
    expect(f.task(f.work).closedBy).toMatchObject({ botId: f.chief.id, name: IDLE_ARCHIVE_NAME });
    const lines = f.store.messagesFor(f.work.threadId).length;
    f.later(2 * HOUR);
    expect(f.sweep()).toEqual([]);
    expect(f.hold(f.work)).toBe("already archived");
    expect(f.store.messagesFor(f.work.threadId)).toHaveLength(lines);
  });

  it("counts from the newest message, so a thread still being used stays", () => {
    const f = fixture();
    f.later(50 * MINUTE);
    f.store.appendMessage(f.self.threadId, { role: "bot", kind: "text", text: "still going", at: f.now() });
    f.later(30 * MINUTE);
    expect(f.sweep().sort()).toEqual([f.fresh.threadId, f.work.threadId].sort());
    f.later(31 * MINUTE);
    expect(f.sweep()).toEqual([f.self.threadId]);
  });

  it("leaves the home, even one a bot opened, and a pinned thread", () => {
    const f = fixture();
    f.store.patchBot(f.maus.id, { mainThreadChoice: f.fresh.threadId });
    f.store.patchTask(f.maus.id, f.work.threadId, { pinned: true });
    f.later(2 * HOUR);
    expect(f.hold(f.fresh)).toBe("the bot's home");
    expect(f.hold(f.work)).toBe("pinned");
    expect(f.sweep()).toEqual([f.self.threadId]);
  });

  it("leaves a thread the person wrote in, and one that only teammates wrote in is still archived", () => {
    const f = fixture();
    f.store.appendMessage(f.self.threadId, { role: "user", kind: "text", text: "what about the tests?" });
    f.store.appendMessage(f.fresh.threadId, { role: "user", kind: "text", text: "[From @Chief] do this", peerAsk: { botId: f.chief.id, name: f.chief.name } });
    f.later(2 * HOUR);
    expect(f.hold(f.self)).toBe("the person wrote here");
    expect(f.sweep().sort()).toEqual([f.fresh.threadId, f.work.threadId].sort());
  });

  it("leaves a thread that is running, queued, waiting on the person, waiting on a teammate, or holding an open card", () => {
    const f = fixture();
    f.busy.add(f.self.threadId);
    f.waiting.add(f.fresh.threadId);
    f.store.appendMessage(f.work.threadId, { role: "bot", kind: "options", card: { title: "Which one?", options: [] } as never });
    f.later(2 * HOUR);
    expect([f.hold(f.self), f.hold(f.fresh), f.hold(f.work)]).toEqual(["busy", "waiting", "a card is open"]);
    expect(f.sweep()).toEqual([]);
    f.busy.clear();
    f.task(f.self).busy = true;
    expect(f.hold(f.self)).toBe("busy");
    f.task(f.self).busy = false;
    f.task(f.self).activity = "waiting-on-you";
    expect(f.hold(f.self)).toBe("busy");
    f.task(f.self).activity = "idle";
    expect(f.hold(f.self)).toBeNull();
  });

  it("is off with a threshold of 0, and reads its three settings from the environment", () => {
    const off = fixture({ OMB_BOT_THREAD_ARCHIVE_MS: "0" });
    off.later(5 * HOUR);
    expect(off.sweep()).toEqual([]);
    expect(off.hold(off.self)).toBe("the sweep is off");
    expect(idleArchiveAfterMs({})).toBe(HOUR);
    expect(idleArchiveAfterMs({ OMB_BOT_THREAD_ARCHIVE_MS: "90000" })).toBe(90_000);
    expect(idleArchiveAfterMs({ OMB_BOT_THREAD_ARCHIVE_MS: "soon" })).toBe(HOUR);
    expect(idleArchiveAfterMs({ OMB_BOT_THREAD_ARCHIVE_MS: "-5" })).toBe(HOUR);
    expect([idleArchiveSweepMs({}), idleArchiveStartMs({})]).toEqual([5 * MINUTE, 5 * MINUTE]);
    expect([idleArchiveSweepMs({ OMB_BOT_THREAD_ARCHIVE_SWEEP_MS: "2000" }), idleArchiveStartMs({ OMB_BOT_THREAD_ARCHIVE_START_MS: "3000" })]).toEqual([2_000, 3_000]);
    expect([idleArchiveSweepMs({ OMB_BOT_THREAD_ARCHIVE_SWEEP_MS: "0" }), idleArchiveStartMs({ OMB_BOT_THREAD_ARCHIVE_START_MS: "0" })]).toEqual([5 * MINUTE, 5 * MINUTE]);
    const short = fixture({ OMB_BOT_THREAD_ARCHIVE_MS: "60000" });
    short.later(61_000);
    expect(short.sweep()).toHaveLength(3);
  });

  it("runs first a while after the server starts, then on its interval, and never when it is off", () => {
    vi.useFakeTimers();
    const f = fixture({ OMB_BOT_THREAD_ARCHIVE_MS: "60000", OMB_BOT_THREAD_ARCHIVE_START_MS: "120000", OMB_BOT_THREAD_ARCHIVE_SWEEP_MS: "30000" });
    f.later(2 * HOUR);
    const running = startIdleArchive(f.deps);
    vi.advanceTimersByTime(119_000);
    expect(f.task(f.self).archivedAt).toBeUndefined();
    vi.advanceTimersByTime(1_000);
    expect(f.task(f.self).archivedAt).toBeDefined();
    reopenIdleArchived(f.store, f.maus.id, f.self.threadId);
    f.store.setTaskClosedBy(f.maus.id, f.self.threadId, null);
    vi.advanceTimersByTime(30_000);
    expect(f.task(f.self).archivedAt, "back, and not idle long enough yet").toBeUndefined();
    f.later(61_000);
    vi.advanceTimersByTime(30_000);
    expect(f.task(f.self).archivedAt, "a later sweep archives it again").toBeDefined();
    running.stop();
    const off = fixture({ OMB_BOT_THREAD_ARCHIVE_MS: "0" });
    off.later(5 * HOUR);
    startIdleArchive(off.deps);
    vi.advanceTimersByTime(HOUR);
    expect(off.task(off.self).archivedAt).toBeUndefined();
  });
});

describe("a message into an archived job", () => {
  it("brings back a thread the sweep archived when a turn starts there, and leaves one the person archived", () => {
    const f = fixture();
    f.store.patchTask(f.maus.id, f.fresh.threadId, { archivedAt: f.now() });
    f.later(2 * HOUR);
    f.sweep();
    expect(f.task(f.self).archivedAt).toBeDefined();
    // The order server/index.ts runs them in when a turn starts.
    reopenIdleArchived(f.store, f.maus.id, f.self.threadId);
    f.store.setTaskClosedBy(f.maus.id, f.self.threadId, null);
    expect(f.task(f.self).archivedAt).toBeUndefined();
    expect(f.task(f.self).closedBy).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(JSON.parse(JSON.stringify(f.task(f.self))), "archivedAt")).toBe(false);
    reopenIdleArchived(f.store, f.maus.id, f.fresh.threadId);
    expect(f.task(f.fresh).archivedAt, "the person's own archive stays").toBeDefined();
    f.store.appendMessage(f.self.threadId, { role: "user", kind: "text", text: "[From @Maus] one more", peerAsk: { botId: f.maus.id, name: f.maus.name }, at: f.now() });
    f.later(30 * MINUTE);
    expect(f.sweep(), "the new turn's activity restarts the hour").toEqual([]);
    f.later(31 * MINUTE);
    expect(f.sweep()).toEqual([f.self.threadId]);
  });

  it("lets the opener send into a thread the sweep archived by its id, and still refuses one the person archived", () => {
    const f = fixture();
    const other = f.store.createTask(f.maus.id, "another", false, undefined, { botId: f.chief.id, name: f.chief.name, threadId: f.chief.threadId, at: f.now() })!;
    f.store.patchTask(f.maus.id, other.threadId, { archivedAt: f.now() });
    f.later(2 * HOUR);
    f.sweep();
    const find = (thread: string) => workThreadFor(f.store, { botId: f.maus.id, botName: f.maus.name, fromBotId: f.chief.id, fromThreadId: f.chief.threadId,
      thread, notice: false, answering: undefined, also: () => true, reach: () => true });
    expect(find(f.fresh.threadId)?.threadId).toBe(f.fresh.threadId);
    expect(() => find(other.threadId)).toThrow("is not a thread you opened on Maus");
  });
});

describe("idle summaries", () => {
  it("skip a job the person never wrote in; the home, the person's threads and a job they wrote in keep them", () => {
    const f = fixture();
    expect([f.self, f.fresh, f.work].map((thread) => unattendedBotJob(f.store, f.maus.id, thread.threadId))).toEqual([true, true, true]);
    expect(unattendedBotJob(f.store, f.maus.id, f.maus.threadId)).toBe(false);
    expect(unattendedBotJob(f.store, f.maus.id, f.own.threadId)).toBe(false);
    expect(unattendedBotJob(f.store, f.maus.id, "gone")).toBe(false);
    f.store.appendMessage(f.self.threadId, { role: "user", kind: "text", text: "one more thing" });
    expect(unattendedBotJob(f.store, f.maus.id, f.self.threadId)).toBe(false);
    f.store.patchBot(f.maus.id, { mainThreadChoice: f.fresh.threadId });
    expect(unattendedBotJob(f.store, f.maus.id, f.fresh.threadId)).toBe(false);
  });
});
