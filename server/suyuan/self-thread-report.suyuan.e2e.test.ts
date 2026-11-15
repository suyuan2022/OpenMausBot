// A thread a bot opens on itself reports back and takes more messages, on one server of the person's own with the scripted
// fake engine (self-thread.ts). The opening conversation is resumed with the thread's result; it sends the thread another
// message with coordinate_bots, its own id and the thread's id, while the thread runs or after it answered; report "none"
// keeps upstream's one-way thread; and the loop guards still hold for a thread opened from a thread and for work that went
// through another bot and came back.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb } from "../../scripts/control-omb.ts";
import { SELF_THREAD_REFUSAL } from "../host/self-threads.ts";
import { hostTimeout } from "../testing/host-timeout.ts";
import { ownTurnText } from "../testing/room-handoff-agent.ts";
import { SELF_NEEDS_THREAD, selfNotOpened } from "./self-thread.ts";

type Row = Record<string, any>;
const jsonl = (path: string): any[] => existsSync(path)
  ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];

function assignments(dataDir: string): Row[] {
  const path = join(dataDir, "runtime.db");
  if (!existsSync(path)) return [];
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return (db.prepare("SELECT json FROM assignments ORDER BY created_at, id").all() as Array<{ json: string }>).map((row) => JSON.parse(row.json) as Row);
  } finally {
    db.close();
  }
}

const THREAD_ID = "\\[thread id: ([\\w-]+)\\]";

async function scenario(test: (f: any) => Promise<void>) {
  const session = await launchVerificationServer({ ...process.env }, undefined, undefined, undefined, undefined, { scripted: true });
  const { url, dataDir } = session.info;
  try {
    const api = async (method: string, path: string, body?: unknown) => {
      const response = await fetch(`${url}${path}`, { method, headers: { "content-type": "application/json", origin: url },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000) });
      const raw = await response.text();
      let parsed: any = raw;
      try { parsed = JSON.parse(raw); } catch {}
      return { status: response.status, body: parsed };
    };
    const bot = async (name: string, section: string) => ((await runControlOmb(["new-bot", "--name", name, "--section", section, "--url", url])) as any).bot;
    const clive = await bot("Clive", "Leadership");
    const mira = await bot("Mira", "Engineering");
    const planPath = join(dataDir, "room-plan.json");
    const plan: Record<string, { script: unknown[] }> = { [clive.id]: { script: [] }, [mira.id]: { script: [] } };
    const script = (botId: string, ...entries: unknown[]) => {
      plan[botId]!.script.push(...entries);
      writeFileSync(planPath, JSON.stringify(plan));
    };
    writeFileSync(planPath, JSON.stringify(plan));
    const say = async (botId: string, threadId: string, text: string) => {
      const sent = await api("POST", `/api/bots/${botId}/messages`, { text, threadId });
      expect(sent.status, JSON.stringify(sent.body)).toBeLessThan(300);
    };
    const children = () => assignments(dataDir).filter((row) => row.parentId);
    const turns = (botId: string): any[] => jsonl(`${planPath}.evidence.jsonl`).filter((turn) => turn.botId === botId);
    const keys = (botId: string) => turns(botId).map((turn) => turn.planKey);
    const turn = (key: string) => jsonl(`${planPath}.evidence.jsonl`).find((candidate) => candidate.planKey === key);
    const told = (key: string): string => { const record = turn(key); return `${record?.system ?? ""}\n${ownTurnText(record?.prompt)}`; };
    /** What each scripted step of a turn got back, as text. */
    const stepTexts = (key: string): string[] => (turn(key)?.evidence ?? []).filter((entry: any) => entry?.step)
      .map((entry: any) => String(entry.response.result?.content?.[0]?.text ?? entry.response.error?.message ?? ""));
    const messages = async (threadId: string): Promise<any[]> => (await api("GET", `/api/threads/${threadId}/messages?limit=300`)).body.messages ?? [];
    const tasks = async (botId: string): Promise<any[]> => ((await api("GET", "/api/bots?messages=0")).body.bots as any[]).find((one) => one.id === botId)?.tasks ?? [];
    const gate = (name: string) => join(dataDir, `${name}.gate`);
    const open = (name: string) => writeFileSync(gate(name), "open");
    const ready = (name: string) => join(dataDir, `${name}.ready`);
    try {
      await test({ api, dataDir, clive, mira, job: clive.activeTaskId as string, script, say, children, turns, keys, turn, told, stepTexts, messages, tasks, gate, open, ready });
    } catch (error) {
      const names: Record<string, string> = { [clive.id]: "Clive", [mira.id]: "Mira" };
      const home = (await messages(clive.activeTaskId).catch(() => [])).slice(-12).map((message: any) => `${message.role}/${message.kind}: ${String(message.text ?? message.tool?.name ?? "").slice(0, 200)}`);
      console.error(`self-thread fixture state:\n${JSON.stringify({ home,
        turns: jsonl(`${planPath}.evidence.jsonl`).map((record) => ({ bot: names[record.botId] ?? record.botId, planKey: record.planKey, unplanned: record.unplanned,
          threadId: record.threadId, own: ownTurnText(record.prompt).slice(0, 700), steps: (record.evidence ?? []).filter((entry: any) => entry?.step)
            .map((entry: any) => String(entry.response.result?.content?.[0]?.text ?? JSON.stringify(entry.response.error ?? "")).slice(0, 400)) })),
        assignments: assignments(dataDir).map(({ id, parentId, status, outcome, executions, result, question, assignee, mode, reply }) =>
          ({ id, parentId, status, outcome, executions, result, question, mode, reply, botId: assignee?.botId, threadId: assignee?.destination?.threadId })),
      }, null, 1)}`);
      throw error;
    }
    expect(turns(clive.id).concat(turns(mira.id)).filter((record) => record.unplanned).map((record) => ownTurnText(record.prompt).slice(0, 300))).toEqual([]);
  } finally {
    await session.close();
  }
}

/** Only the thread's own turn reads this. The opening conversation is told the brief of work it still waits on, so a
 * script entry for the thread matches on this too, or a turn there would run it. */
const OWN = "here is you: you opened this thread yourself";

/** The id start_thread gave the turn `key`, read from what its step answered. */
const openedThread = (f: any, key: string, at = 0): string => new RegExp(THREAD_ID).exec(f.stepTexts(key)[at] ?? "")?.[1] ?? "";

it("S1+S2 resumes the opening conversation with the thread's result, and a message sent with the bot's own id and the thread id runs there and reports again", () => scenario(async (f) => {
  f.script(f.clive.id,
    { key: "C0", match: ["S1-JOB"], steps: [{ tool: "start_thread", arguments: { title: "S1 count", message: "S1-CHILD: count the files." } }], reply: "C0: opened." },
    { key: "K1", match: ["S1-CHILD", OWN], gateFile: f.gate("k1"), reply: "K1-RESULT: 12 files." },
    { key: "K2", match: ["S2-MORE", OWN], reply: "K2-RESULT: 3 folders." },
    { key: "C2", match: ["K2-RESULT"], reply: "C2: all done." });
  await f.say(f.clive.id, f.job, "S1-JOB: count the files in a thread of your own.");
  await expect.poll(() => f.keys(f.clive.id), { timeout: 60_000 }).toContain("C0");
  const child = openedThread(f, "C0");
  expect(child, f.stepTexts("C0")[0]).not.toBe("");
  expect(child).not.toBe(f.job);
  expect(f.stepTexts("C0")[0]).toContain("its result returns to this conversation and resumes you");
  expect(f.stepTexts("C0")[0]).toContain(`call coordinate_bots with bot_ids ["${f.clive.id}"] and thread "${child}"`);
  // The resumed turn sends the thread another message, by its id.
  f.script(f.clive.id, { key: "C1", match: ["K1-RESULT"], steps: [{ arguments: { bot_ids: [f.clive.id], message: "S2-MORE: also count the folders.", thread: child } }], reply: "C1: asked for more." });
  f.open("k1");
  await expect.poll(() => f.keys(f.clive.id), { timeout: 90_000 }).toEqual(["C0", "K1", "C1", "K2", "C2"]);
  expect(f.turn("K1").threadId).toBe(child);
  expect(f.turn("K2").threadId, "the second message runs in the same thread").toBe(child);
  expect(f.turn("C1").threadId).toBe(f.job);
  expect(f.turn("C2").threadId).toBe(f.job);
  expect(f.told("K1"), "the thread reads that the brief is its own words").toContain("here is you: you opened this thread yourself");
  expect(f.told("K1")).toContain("[From @Clive (bot) · assignment ");
  expect(f.told("C1"), "the resumed turn reads the thread's result").toContain("K1-RESULT: 12 files.");
  expect(f.told("C1")).toContain(`This report comes from a thread you opened on yourself [thread id: ${child}].`);
  expect(f.told("C2")).toContain("K2-RESULT: 3 folders.");
  const rows = f.children();
  expect(rows.map((row: any) => [row.assignee?.botId, row.assignee?.destination?.threadId, row.reply, row.status])).toEqual([
    [f.clive.id, child, "resume", "completed"], [f.clive.id, child, "resume", "completed"]]);
  const record = (await f.tasks(f.clive.id)).find((task: any) => task.threadId === child);
  expect(record?.title).toBe("S1 count");
  expect(record?.openedBy).toMatchObject({ botId: f.clive.id, threadId: f.job });
  // The opening conversation keeps a chip to the thread, worded for a thread and not for a teammate.
  const chips = (await f.messages(f.job)).filter((message: any) => message.threadRef?.threadId === child).map((message: any) => message.tool?.name);
  expect(chips[0]).toBe("Opened thread #S1 count");
  expect(chips).toContain("Sent to #S1 count");
}), hostTimeout(180_000));

it("S3 a message sent while the thread still runs reaches it, inside that turn or as its next one", () => scenario(async (f) => {
  f.script(f.clive.id,
    { key: "C0", match: ["S3-JOB"], steps: [{ tool: "start_thread", arguments: { title: "S3 audit", message: "S3-CHILD: audit the folder." } }], reply: "C0: opened." },
    { key: "K1", match: ["S3-CHILD", OWN], readyFile: f.ready("k1"), gateFile: f.gate("k1"), echoSteered: true, timeoutMs: 120_000, reply: "K1-RESULT: audited." },
    { key: "KX", match: ["S3-EXTRA", OWN], reply: "KX-RESULT: hidden files too." },
    { key: "R1", match: ["K1-RESULT"], reply: "R1: noted." },
    { key: "RX", match: ["KX-RESULT"], reply: "RX: noted." });
  await f.say(f.clive.id, f.job, "S3-JOB: audit the folder in a thread of your own.");
  await expect.poll(() => f.keys(f.clive.id), { timeout: 60_000 }).toContain("C0");
  const child = openedThread(f, "C0");
  await expect.poll(() => existsSync(f.ready("k1")), { timeout: 60_000 }).toBe(true);
  f.script(f.clive.id, { key: "C1", match: ["S3-NUDGE"], steps: [{ arguments: { bot_ids: [f.clive.id], message: "S3-EXTRA: include hidden files.", thread: child } }], reply: "C1: passed on." });
  await f.say(f.clive.id, f.job, "S3-NUDGE: tell that thread to include hidden files.");
  await expect.poll(() => f.keys(f.clive.id), { timeout: 60_000 }).toContain("C1");
  const receipt = JSON.parse(f.stepTexts("C1")[0]!).receipts[0];
  expect(receipt.outcome, JSON.stringify(receipt)).toMatch(/injected|queued/);
  expect(receipt.threadId).toBe(child);
  f.open("k1");
  await expect.poll(() => f.keys(f.clive.id).includes("K1"), { timeout: 60_000 }).toBe(true);
  // Either the running turn read it at its next step, or it ran as the thread's next turn: the words arrive once.
  await expect.poll(async () => {
    const said = (await f.messages(child)).filter((message: any) => message.role === "bot" && message.kind === "text").map((message: any) => String(message.text));
    return said.some((text: string) => text.includes("steered: ") && text.includes("S3-EXTRA")) || said.some((text: string) => text.includes("KX-RESULT"));
  }, { timeout: 90_000 }).toBe(true);
  const inThread = (await f.messages(child)).filter((message: any) => JSON.stringify(message).includes("S3-EXTRA: include hidden files."));
  expect(inThread.length, "the message is in the thread").toBeGreaterThan(0);
  // And the opening conversation hears back.
  await expect.poll(() => f.keys(f.clive.id).some((key: string) => key === "R1" || key === "RX"), { timeout: 90_000 }).toBe(true);
}), hostTimeout(240_000));

it("S4 report none opens upstream's one-way thread: it runs, and nothing resumes the opening conversation", () => scenario(async (f) => {
  f.script(f.clive.id,
    { key: "C0", match: ["S4-JOB"], steps: [{ tool: "start_thread", arguments: { title: "S4 quiet", message: "S4-CHILD: tidy up.", report: "none" } }], reply: "C0: opened." },
    { key: "K1", match: ["S4-CHILD"], reply: "K1-RESULT: tidied." });
  await f.say(f.clive.id, f.job, "S4-JOB: tidy up in a thread of your own, no need to tell me.");
  await expect.poll(() => f.keys(f.clive.id), { timeout: 90_000 }).toEqual(["C0", "K1"]);
  const child = openedThread(f, "C0");
  expect(f.stepTexts("C0")[0]).toContain("its result stays in that thread");
  await expect.poll(async () => (await f.messages(child)).filter((message: any) => message.role === "bot" && message.kind === "text" && String(message.text).includes("K1-RESULT")).length, { timeout: 30_000 }).toBe(1);
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  expect(f.keys(f.clive.id), "nothing resumed the opening conversation").toEqual(["C0", "K1"]);
  expect(f.children()).toEqual([]);
  expect(f.told("K1")).toContain("[Thread you opened yourself");
}), hostTimeout(180_000));

it("S5 two threads opened in one turn both run, and one resume carries both results", () => scenario(async (f) => {
  f.script(f.clive.id,
    { key: "C0", match: ["S5-JOB"], steps: [
      { tool: "start_thread", arguments: { title: "S5 A", message: "S5-A-CHILD: review A." } },
      { tool: "start_thread", arguments: { title: "S5 B", message: "S5-B-CHILD: review B." } }], reply: "C0: opened two." },
    { key: "KA", match: ["S5-A-CHILD", OWN], reply: "KA-RESULT: A is fine." },
    { key: "KB", match: ["S5-B-CHILD", OWN], reply: "KB-RESULT: B is fine." },
    { key: "C1", match: ["KA-RESULT", "KB-RESULT"], reply: "C1: both fine." });
  await f.say(f.clive.id, f.job, "S5-JOB: review A and B, each in a thread of your own.");
  await expect.poll(() => [...f.keys(f.clive.id)].sort(), { timeout: 120_000 }).toEqual(["C0", "C1", "KA", "KB"]);
  const [a, b] = [openedThread(f, "C0", 0), openedThread(f, "C0", 1)];
  expect(a).not.toBe("");
  expect(b).not.toBe("");
  expect(a).not.toBe(b);
  expect(f.turn("KA").threadId).toBe(a);
  expect(f.turn("KB").threadId).toBe(b);
  expect(f.turn("C1").threadId).toBe(f.job);
  expect(f.children().map((row: any) => row.status)).toEqual(["completed", "completed"]);
}), hostTimeout(180_000));

it("S6 keeps the loop guards: no thread from a thread, no work to itself without a thread of its own, none back through a teammate", () => scenario(async (f) => {
  f.script(f.clive.id,
    { key: "C0", match: ["S6-JOB"], steps: [
      { arguments: { bot_ids: [f.clive.id], message: "S6-SELF: do this." }, expectError: true },
      { arguments: { bot_ids: [f.clive.id], message: "S6-SELF: do this.", thread: "new" }, expectError: true },
      { arguments: { bot_ids: [f.clive.id], message: "S6-SELF: do this.", thread: f.mira.activeTaskId }, expectError: true },
      { arguments: { bot_ids: [f.clive.id], message: "S6-SELF: do this.", thread: f.job }, expectError: true },
      { tool: "start_thread", arguments: { title: "S6 child", message: "S6-CHILD: try to fan out." } },
      { arguments: { bot_ids: [f.mira.id], message: "S6-MIRA: try to send it back." } }], reply: "C0: sent." },
    { key: "K1", match: ["S6-CHILD", OWN], steps: [
      { tool: "start_thread", arguments: { title: "S6 grandchild", message: "S6-GRAND: more." }, expectError: true },
      { arguments: { bot_ids: [f.clive.id], message: "S6-GRAND: more.", thread: "new" }, expectError: true }], reply: "K1-RESULT: refused twice." },
    { key: "C1", match: ["K1-RESULT", "M0-RESULT"], reply: "C1: done." });
  f.script(f.mira.id, { key: "M0", match: ["S6-MIRA"], steps: [
    { arguments: { bot_ids: [f.clive.id], message: "S6-BACK: yours again." }, expectError: true },
    { arguments: { bot_ids: [f.clive.id], message: "S6-BACK: yours again.", thread: "new" }, expectError: true }], reply: "M0-RESULT: refused twice." });
  await f.say(f.clive.id, f.job, "S6-JOB: try every way round.");
  await expect.poll(() => [...f.keys(f.clive.id)].sort(), { timeout: 120_000 }).toEqual(["C0", "C1", "K1"]);
  const root = f.stepTexts("C0");
  expect(root[0]).toContain(SELF_NEEDS_THREAD);
  expect(root[1]).toContain(SELF_NEEDS_THREAD);
  expect(root[2]).toContain(selfNotOpened(f.mira.activeTaskId));
  expect(root[3]).toContain("That is the thread you are speaking in");
  const child = f.stepTexts("K1");
  expect(child[0]).toContain(SELF_THREAD_REFUSAL);
  expect(child[1]).toContain(SELF_THREAD_REFUSAL);
  for (const text of f.stepTexts("M0")) expect(text).toContain("Cannot assign work back to an ancestor");
  expect((await f.tasks(f.clive.id)).map((task: any) => task.title)).not.toContain("S6 grandchild");
}), hostTimeout(180_000));

it("S7 a message sent into a thread that was closed and archived brings it back, runs there and reports", () => scenario(async (f) => {
  f.script(f.clive.id,
    { key: "C0", match: ["S7-JOB"], steps: [{ tool: "start_thread", arguments: { title: "S7 notes", message: "S7-CHILD: take notes." } }], reply: "C0: opened." },
    { key: "K1", match: ["S7-CHILD", OWN], gateFile: f.gate("k1"), reply: "K1-RESULT: notes taken." },
    { key: "K2", match: ["S7-MORE", OWN], reply: "K2-RESULT: notes extended." },
    { key: "C3", match: ["K2-RESULT"], reply: "C3: all done." });
  await f.say(f.clive.id, f.job, "S7-JOB: take notes in a thread of your own.");
  await expect.poll(() => f.keys(f.clive.id), { timeout: 60_000 }).toContain("C0");
  const child = openedThread(f, "C0");
  // The resumed turn closes the thread, and it is then archived: the state an idle thread a bot opened is left in.
  f.script(f.clive.id, { key: "C1", match: ["K1-RESULT"], steps: [{ tool: "close_thread", arguments: { thread_id: child } }], reply: "C1: closed it." });
  f.open("k1");
  await expect.poll(() => f.keys(f.clive.id), { timeout: 90_000 }).toEqual(["C0", "K1", "C1"]);
  const archived = await f.api("PATCH", `/api/bots/${f.clive.id}/tasks/${child}`, { archivedAt: Date.now() });
  expect(archived.status, JSON.stringify(archived.body)).toBeLessThan(300);
  const before = (await f.tasks(f.clive.id)).find((task: any) => task.threadId === child);
  expect(before?.archivedAt).toBeTypeOf("number");
  expect(before?.closedBy, "close_thread closed it").toBeTruthy();
  f.script(f.clive.id, { key: "C2", match: ["S7-AGAIN"], steps: [{ arguments: { bot_ids: [f.clive.id], message: "S7-MORE: add yesterday's.", thread: child } }], reply: "C2: asked for more." });
  await f.say(f.clive.id, f.job, "S7-AGAIN: have that thread add yesterday's notes.");
  await expect.poll(() => f.keys(f.clive.id), { timeout: 90_000 }).toEqual(["C0", "K1", "C1", "C2", "K2", "C3"]);
  expect(f.turn("K2").threadId, "the message runs in the same thread, not a new one").toBe(child);
  const after = (await f.tasks(f.clive.id)).find((task: any) => task.threadId === child);
  expect(after?.archivedAt, "the thread is back in the list").toBeUndefined();
  expect(after?.closedBy ?? null, "and open again").toBeNull();
  expect(f.told("C3")).toContain("K2-RESULT: notes extended.");
}), hostTimeout(180_000));
