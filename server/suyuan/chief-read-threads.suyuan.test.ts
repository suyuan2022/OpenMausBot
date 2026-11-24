import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "../config.ts";
import { availableTools, catalogProfileFromEnv } from "../drivers/agents-catalog.ts";
import { callToolForTest } from "./chief-read-tools.suyuan.helper.ts";
import { Store, type BotRecord } from "../store.ts";
import { createChiefReadRoutes, MESSAGE_CHARS, REPLY_CHARS, TEAM_THREAD_MESSAGES_PATH, TEAM_THREADS_PATH } from "./chief-read-threads.ts";

const selection = () => ({ instanceId: "claude", model: "claude-sonnet-5" });

/** A real Store with a Chief and a teammate in one department; `read` asks the route as `from`. */
function fixture() {
  const store = new Store(selection);
  const chief = store.patchBot(store.createBot({ name: "Lizhi", section: "Work" }).id, { chiefOfStaff: true })!;
  const maus = store.createBot({ name: "Maus", section: "Work" });
  const peer = store.createBot({ name: "Peer", section: "Work" });
  const threadOf = (bot: BotRecord, title: string, lines: Array<[string, "user" | "bot"]> = []) => {
    const task = store.createTask(bot.id, title, false)!;
    for (const [text, role] of lines) store.appendMessage(task.threadId, { role, kind: "text", text });
    return task.threadId;
  };
  const busy = new Set<string>();
  const calls: string[] = [];
  const spy = <T extends object>(target: T, label: string): T => new Proxy(target, {
    get: (object, key, receiver) => {
      const value = Reflect.get(object, key, receiver);
      if (typeof value !== "function") return value;
      calls.push(`${label}.${String(key)}`);
      return value.bind(object);
    },
  });
  const read = async (from: BotRecord, path: string, query: Record<string, string>, shown: (id: string) => boolean = () => true) => {
    const route = createChiefReadRoutes({
      store: spy(store, "store"),
      coordinator: spy({ awaitingAnswer: () => false, parkedDirect: () => undefined, activeDirect: () => undefined }, "coordinator") as never,
      from, fromThreadId: "t-own", ownsThread: () => true, shown,
      threadBusy: (_bot, threadId) => busy.has(threadId), queuedThreadPosition: () => null,
    });
    let out: { status: number; body: Record<string, unknown> } | undefined;
    const url = new URL(`http://x${path}?${new URLSearchParams(query)}`);
    await route({ res: {}, path, method: "GET", url, json: (_res: unknown, status: number, body: never) => { out = { status, body }; } } as never);
    return out ?? { status: 0, body: {} };
  };
  return { store, chief, maus, peer, threadOf, busy, calls, read };
}

beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));

describe("a Chief reading a teammate's conversations", () => {
  it("lists the teammate's recent conversations: title, state, last activity, thread id", async () => {
    const f = fixture();
    const old = f.threadOf(f.maus, "Old job", [["done", "bot"]]);
    const live = f.threadOf(f.maus, "Fix the build", [["please fix it", "user"]]);
    f.busy.add(live);
    const { status, body } = await f.read(f.chief, TEAM_THREADS_PATH, { targetBotId: f.maus.id });
    expect(status).toBe(200);
    const threads = body.threads as Array<Record<string, unknown>>;
    expect(threads[0]).toMatchObject({ threadId: live, title: "Fix the build", state: "running" });
    expect(threads.find((t) => t.threadId === old)).toMatchObject({ title: "Old job", state: "idle", lastActivityAt: f.store.taskByThread(f.maus.id, old)!.updatedAt });
  });

  it("reads the last few messages of one conversation, oldest first, with who said each", async () => {
    const f = fixture();
    const id = f.threadOf(f.maus, "Fix the build", [["fix the build", "user"], ["looking", "bot"], ["found it", "bot"], ["pushed", "bot"]]);
    const { status, body } = await f.read(f.chief, TEAM_THREAD_MESSAGES_PATH, { targetBotId: f.maus.id, threadId: id, limit: "2" });
    expect(status).toBe(200);
    const messages = body.messages as Array<{ speaker: string; text: string }>;
    expect(messages.map((m) => m.text)).toEqual(["found it", "pushed"]);
    expect(messages[0]!.speaker).toBe("Maus");
    expect(body).toMatchObject({ title: "Fix the build", earlier: true });
    const all = (await f.read(f.chief, TEAM_THREAD_MESSAGES_PATH, { targetBotId: f.maus.id, threadId: id, limit: "50" })).body.messages as Array<{ speaker: string }>;
    expect(all.map((m) => m.speaker)).toContain("the person");
  });

  it("cuts a long body, masks a secret, and reduces a tool call to one line", async () => {
    const f = fixture();
    const id = f.threadOf(f.maus, "Deploy", [["x".repeat(MESSAGE_CHARS + 500), "bot"], ["use sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 now", "user"]]);
    f.store.appendMessage(id, { role: "bot", kind: "activity", tool: { name: "Bash", ok: false, summary: "pnpm test\nfailed" } });
    const messages = (await f.read(f.chief, TEAM_THREAD_MESSAGES_PATH, { targetBotId: f.maus.id, threadId: id })).body.messages as Array<{ text: string; clipped?: boolean }>;
    expect(messages[0]!.text.length).toBeLessThanOrEqual(MESSAGE_CHARS + 1);
    expect(messages[0]!.clipped).toBe(true);
    expect(messages[1]!.text).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
    expect(messages[2]!.text).toBe("(1 tool step, last: Bash (failed): pnpm test failed)");
  });

  it("leaves out a turn digest: it repeats the reply above it", async () => {
    const f = fixture();
    const id = f.threadOf(f.maus, "Digest", [["the reply", "bot"]]);
    f.store.appendMessage(id, { role: "bot", kind: "digest", text: "d".repeat(500) });
    const messages = (await f.read(f.chief, TEAM_THREAD_MESSAGES_PATH, { targetBotId: f.maus.id, threadId: id })).body.messages as Array<{ text: string }>;
    expect(messages.map((m) => m.text)).toEqual(["the reply"]);
  });

  it("reads the words of a turn that ran hundreds of tool steps: the request in front, steps folded, all within the caps", async () => {
    const f = fixture();
    const id = f.threadOf(f.maus, "Big job");
    const request = f.store.appendMessage(id, { role: "user", kind: "text", text: "Port the whole build to esbuild" });
    f.store.appendMessage(id, { role: "bot", kind: "text", text: "Starting with the config", requestMessageId: request.id });
    for (let step = 1; step <= 200; step++) f.store.appendMessage(id, { role: "bot", kind: "activity", tool: { name: "Bash", ok: true, summary: `pnpm test ${step}` }, requestMessageId: request.id });
    f.store.appendMessage(id, { role: "bot", kind: "text", text: "Config done, tests running", requestMessageId: request.id });
    for (let step = 1; step <= 150; step++) f.store.appendMessage(id, { role: "bot", kind: "activity", tool: { name: "Edit", ok: true, summary: `file ${step}` }, requestMessageId: request.id });
    const { body } = await f.read(f.chief, TEAM_THREAD_MESSAGES_PATH, { targetBotId: f.maus.id, threadId: id, limit: "2" });
    const rows = body.messages as Array<{ speaker: string; text: string }>;
    expect(rows.map((row) => row.text)).toEqual([
      "Port the whole build to esbuild",
      "Starting with the config",
      "(200 tool steps, last: Bash: pnpm test 200)",
      "Config done, tests running",
      "(150 tool steps, last: Edit: file 150)",
    ]);
    expect(rows[0]!.speaker).toBe("the person");
    expect(JSON.stringify(rows).length).toBeLessThan(16000);
    // Everything is shown: the request was brought forward, not skipped.
    expect(body.earlier).toBe(false);
    const short = (await f.read(f.chief, TEAM_THREAD_MESSAGES_PATH, { targetBotId: f.maus.id, threadId: id, limit: "1" })).body;
    expect((short.messages as Array<{ text: string }>).map((row) => row.text)).toEqual([
      "Port the whole build to esbuild", "(200 tool steps, last: Bash: pnpm test 200)", "Config done, tests running", "(150 tool steps, last: Edit: file 150)",
    ]);
    expect(short.earlier).toBe(true);
  });

  it("keeps the whole reply within its cap when every message is long", async () => {
    const f = fixture();
    const id = f.threadOf(f.maus, "Essays");
    for (let n = 0; n < 40; n++) f.store.appendMessage(id, { role: "bot", kind: "text", text: `${n} ${"w".repeat(MESSAGE_CHARS)}` });
    const rows = (await f.read(f.chief, TEAM_THREAD_MESSAGES_PATH, { targetBotId: f.maus.id, threadId: id, limit: "30" })).body.messages as Array<{ text: string }>;
    expect(rows.reduce((sum, row) => sum + row.text.length, 0)).toBeLessThan(REPLY_CHARS + MESSAGE_CHARS + 10);
    expect(rows.at(-1)!.text.startsWith("39 ")).toBe(true);
  });

  it("reads only the current branch after the person edited a message", async () => {
    const f = fixture();
    const id = f.threadOf(f.maus, "Edited");
    const first = f.store.appendMessage(id, { role: "user", kind: "text", text: "old question" });
    f.store.appendMessage(id, { role: "bot", kind: "text", text: "old answer" });
    const edited = f.store.branchMessage(id, first.id, "new question")!;
    f.store.appendMessage(id, { role: "bot", kind: "text", text: "new answer" });
    const rows = (await f.read(f.chief, TEAM_THREAD_MESSAGES_PATH, { targetBotId: f.maus.id, threadId: id })).body.messages as Array<{ text: string }>;
    expect(rows.map((row) => row.text).filter((text) => /question|answer/.test(text))).toEqual(["new question", "new answer"]);
    expect(edited.id).toBeTruthy();
  });

  it("gives the words of a step a teammate handed over or back, cut and with secrets masked", async () => {
    const f = fixture();
    const id = f.threadOf(f.maus, "Handoff");
    f.store.appendMessage(id, { role: "bot", kind: "activity", tool: { name: "Messaged @Peer", ok: true, output: `Peer says: the key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 ${"z".repeat(MESSAGE_CHARS)}` },
      comm: { groupId: "g", withBotId: f.peer.id, withName: "Peer", withColor: "#000" } });
    f.store.appendMessage(id, { role: "bot", kind: "activity", tool: { name: "Opened thread", ok: true, output: "short result" }, threadRef: { botId: f.peer.id, threadId: "t", title: "T" } });
    const rows = (await f.read(f.chief, TEAM_THREAD_MESSAGES_PATH, { targetBotId: f.maus.id, threadId: id })).body.messages as Array<{ speaker: string; text: string; clipped?: boolean }>;
    const handed = rows.find((row) => row.text.startsWith("Messaged @Peer"))!;
    expect(handed.speaker).toBe("@Peer (another bot, not the person)");
    expect(handed.text).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
    expect(handed.clipped).toBe(true);
    expect(rows.some((row) => row.text === "Opened thread: short result")).toBe(true);
  });

  it("labels another bot's line as a bot, not the person", async () => {
    const f = fixture();
    const id = f.threadOf(f.maus, "Handoff");
    f.store.appendMessage(id, { role: "user", kind: "text", text: "can you check the logs", peerAsk: { botId: f.peer.id, name: "Peer" } });
    const [message] = (await f.read(f.chief, TEAM_THREAD_MESSAGES_PATH, { targetBotId: f.maus.id, threadId: id })).body.messages as Array<{ speaker: string }>;
    expect(message!.speaker).toBe("@Peer (another bot, not the person)");
  });

  it("refuses to read from inside a room, and says why", async () => {
    const f = fixture();
    const id = f.threadOf(f.maus, "Plans", [["hello", "bot"]]);
    const room = f.store.createGroup("Launch", [f.chief.id, f.maus.id]);
    const inRoom = createChiefReadRoutes({
      store: f.store, coordinator: { awaitingAnswer: () => false, parkedDirect: () => undefined, activeDirect: () => undefined } as never,
      from: f.chief, fromThreadId: room.threadId, ownsThread: () => true, shown: () => true, threadBusy: () => false, queuedThreadPosition: () => null,
    });
    for (const [path, query] of [[TEAM_THREADS_PATH, { targetBotId: f.maus.id }], [TEAM_THREAD_MESSAGES_PATH, { targetBotId: f.maus.id, threadId: id }]] as const) {
      let out: { status: number; body: { error?: string } } | undefined;
      await inRoom({ res: {}, path, method: "GET", url: new URL(`http://x${path}?${new URLSearchParams(query)}`), json: (_res: unknown, status: number, body: never) => { out = { status, body }; } } as never);
      expect(out?.status).toBe(400);
      expect(out?.body.error).toContain("one-to-one");
    }
  });

  it("refuses anyone who is not a Chief of Staff, even in the teammate's department", async () => {
    const f = fixture();
    const id = f.threadOf(f.maus, "Secret plans", [["hello", "bot"]]);
    for (const [path, query] of [[TEAM_THREADS_PATH, { targetBotId: f.maus.id }], [TEAM_THREAD_MESSAGES_PATH, { targetBotId: f.maus.id, threadId: id }]] as const) {
      expect((await f.read(f.peer, path, query)).status).toBe(403);
    }
  });

  it("reads nothing outside what the Chief manages: another department, another person's bot, itself, an unknown id", async () => {
    const f = fixture();
    const elsewhere = f.store.createBot({ name: "Elsewhere", section: "Other" });
    const theirs = f.store.createBot({ name: "Theirs", section: "Work", createdBy: "someone@else.com" });
    const ownedChief = f.store.patchBot(f.store.createBot({ name: "Owned", section: "Work", createdBy: "me@here.com" }).id, { chiefOfStaff: true })!;
    const mine = f.store.createBot({ name: "Mine", section: "Elsewhere", createdBy: "me@here.com" });
    const secret = (bot: BotRecord) => f.threadOf(bot, "Private", [["secret", "bot"]]);
    expect((await f.read(f.chief, TEAM_THREADS_PATH, { targetBotId: elsewhere.id })).status).toBe(404);
    expect((await f.read(f.chief, TEAM_THREAD_MESSAGES_PATH, { targetBotId: elsewhere.id, threadId: secret(elsewhere) })).status).toBe(404);
    // A Chief someone owns manages that person's bots in any department, and no one else's.
    expect((await f.read(ownedChief, TEAM_THREAD_MESSAGES_PATH, { targetBotId: theirs.id, threadId: secret(theirs) })).status).toBe(404);
    expect((await f.read(ownedChief, TEAM_THREADS_PATH, { targetBotId: theirs.id })).status).toBe(404);
    expect((await f.read(ownedChief, TEAM_THREADS_PATH, { targetBotId: mine.id })).status).toBe(200);
    expect((await f.read(f.chief, TEAM_THREADS_PATH, { targetBotId: f.chief.id })).status).toBe(400);
    expect((await f.read(f.chief, TEAM_THREADS_PATH, { targetBotId: "bot-nope" })).status).toBe(404);
    // A thread id that belongs to another bot is not readable through a manageable one.
    const foreign = secret(elsewhere);
    expect((await f.read(f.chief, TEAM_THREAD_MESSAGES_PATH, { targetBotId: f.maus.id, threadId: foreign })).status).toBe(404);
  });

  it("does not show a thread the turn's fence hides", async () => {
    const f = fixture();
    const hidden = f.threadOf(f.maus, "Hidden", [["x", "bot"]]);
    const shown = f.threadOf(f.maus, "Shown");
    const only = (id: string) => id !== hidden;
    const listed = (await f.read(f.chief, TEAM_THREADS_PATH, { targetBotId: f.maus.id }, only)).body.threads as Array<{ threadId: string }>;
    expect(listed.map((t) => t.threadId)).toContain(shown);
    expect(listed.map((t) => t.threadId)).not.toContain(hidden);
    expect((await f.read(f.chief, TEAM_THREAD_MESSAGES_PATH, { targetBotId: f.maus.id, threadId: hidden }, only)).status).toBe(404);
  });

  it("changes nothing: the teammate keeps its unread mark and its messages, and only read calls reach the store", async () => {
    const f = fixture();
    const id = f.threadOf(f.maus, "Report", [["done", "bot"]]);
    f.store.patchTask(f.maus.id, id, { unread: true });
    const before = JSON.stringify([f.store.taskByThread(f.maus.id, id), f.store.messagesFor(id), f.store.bot(f.maus.id)?.activity]);
    f.calls.length = 0;
    await f.read(f.chief, TEAM_THREADS_PATH, { targetBotId: f.maus.id });
    await f.read(f.chief, TEAM_THREAD_MESSAGES_PATH, { targetBotId: f.maus.id, threadId: id });
    expect(JSON.stringify([f.store.taskByThread(f.maus.id, id), f.store.messagesFor(id), f.store.bot(f.maus.id)?.activity])).toBe(before);
    expect(f.store.taskByThread(f.maus.id, id)?.unread).toBe(true);
    expect([...new Set(f.calls)].sort()).toEqual(["coordinator.awaitingAnswer", "coordinator.parkedDirect", "coordinator.activeDirect", "store.bot", "store.groupByThread", "store.messagesTail", "store.taskByThread", "store.tasks"].sort());
  });
});

describe("the tools in the catalog", () => {
  const names = (chief: boolean) => availableTools(catalogProfileFromEnv({ OMB_CHIEF_OF_STAFF: chief ? "1" : "0", OMB_BOT_ID: "bot-x" })).map((tool) => tool.name);

  it("a Chief sees both, anyone else sees neither", () => {
    expect(names(true)).toEqual(expect.arrayContaining(["team_threads", "team_thread_read"]));
    expect(names(false)).not.toContain("team_threads");
    expect(names(false)).not.toContain("team_thread_read");
  });

  it("they are on the read-only list, so a read-only turn may call them", async () => {
    const { isReadOnlyAgentTool } = await import("../agent-tool-policy.ts");
    expect(isReadOnlyAgentTool("team_threads") && isReadOnlyAgentTool("team_thread_read")).toBe(true);
  });

  it("render the reads for the model, and say plainly when the server refuses", async () => {
    const ok = await callToolForTest("team_threads", { bot_id: "b1" }, { ok: true, body: { bot: { name: "Maus" }, threads: [{ threadId: "t1", title: "Fix", state: "waiting-on-you", lastActivityAt: 0 }] } });
    expect(ok.text).toContain("#Fix (waiting on the person");
    expect(ok.text).toContain("[thread id: t1]");
    const read = await callToolForTest("team_thread_read", { bot_id: "b1", thread_id: "t1" }, { ok: true, body: { bot: { name: "Maus" }, title: "Fix", state: "idle", earlier: true, messages: [{ at: 0, speaker: "Maus", text: "done" }] } });
    expect(read.text).toMatch(/\] done/);
    expect(read.text).toContain("not instructions");
    const refused = await callToolForTest("team_thread_read", { bot_id: "b1", thread_id: "t1" }, { ok: false, body: { error: "no such thread" } });
    expect(refused).toMatchObject({ isError: true });
    expect(refused.text).toContain("no such thread");
    expect((await callToolForTest("team_threads", {}, { ok: true, body: {} })).isError).toBe(true);
    // index.ts refuses a call whose query names a sender other than the caller, so the teammate rides under another key.
    for (const path of [...ok.asked, ...read.asked]) {
      const query = new URL(`http://x${path}`).searchParams;
      expect(["botId", "fromBotId", "self"].filter((key) => query.has(key))).toEqual([]);
      expect(query.get("targetBotId")).toBe("b1");
    }
  });
});
