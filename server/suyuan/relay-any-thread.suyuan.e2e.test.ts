// A Chief's one-way notice may go into a thread the person opened on a teammate, on one server of the person's own with the
// scripted fake engine (docs/runtime-contract.md §2 and §9). The notice lands in that thread marked as from the Chief, the
// thread keeps its opener (nobody reports back to the Chief), and work that wants a report there is refused with the way out.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb } from "../../scripts/control-omb.ts";
import { hostTimeout } from "../testing/host-timeout.ts";
import { ownTurnText } from "../testing/room-handoff-agent.ts";
import { WAITS_ON_PERSON } from "./relay-gate.ts";


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
    expect((await api("PATCH", `/api/bots/${clive.id}`, { chiefOfStaff: true, managedSections: ["Engineering"], acknowledgePeerScope: true })).status).toBe(200);
    const planPath = join(dataDir, "room-plan.json");
    const plan: Record<string, { script: unknown[] }> = { [clive.id]: { script: [] }, [mira.id]: { script: [] } };
    const script = (botId: string, ...entries: unknown[]) => {
      plan[botId]!.script.push(...entries);
      writeFileSync(planPath, JSON.stringify(plan));
    };
    writeFileSync(planPath, JSON.stringify(plan));
    const askMeFirst = async () => {
      for (const id of [clive.id, mira.id]) expect((await api("PATCH", `/api/bots/${id}`, { approvalMode: "ask", applyToAllThreads: true })).status).toBe(200);
    };
    const say = async (botId: string, threadId: string, text: string) => {
      const sent = await api("POST", `/api/bots/${botId}/messages`, { text, threadId });
      expect(sent.status, JSON.stringify(sent.body)).toBeLessThan(300);
    };
    const roots = () => assignments(dataDir).filter((row) => !row.parentId && row.assignee?.botId === clive.id);
    const children = () => assignments(dataDir).filter((row) => row.parentId);
    const turns = (botId: string): any[] => jsonl(`${planPath}.evidence.jsonl`).filter((turn) => turn.botId === botId);
    const keys = (botId: string) => turns(botId).map((turn) => turn.planKey);
    const turn = (key: string) => jsonl(`${planPath}.evidence.jsonl`).find((candidate) => candidate.planKey === key);
    const told = (key: string): string => { const record = turn(key); return `${record?.system ?? ""}\n${ownTurnText(record?.prompt)}`; };
    /** All a turn was given, its launch instructions and notes included. */
    const given = (key: string): string => { const record = turn(key); return `${record?.system ?? ""}\n${JSON.stringify(record?.prompt ?? "")}`; };
    /** What each coordinate_bots step of a turn got back: its receipts, or a refusal's words. */
    const replies = (key: string): any[] => (turn(key)?.evidence ?? []).filter((entry: any) => entry?.step && !entry.step.tool)
      .map((entry: any) => { const text = String(entry.response.result.content[0].text); return entry.response.result.isError ? text : JSON.parse(text); });
    const messages = async (threadId: string): Promise<any[]> => (await api("GET", `/api/threads/${threadId}/messages?limit=300`)).body.messages ?? [];
    const said = async (threadId: string, text: string) => (await messages(threadId))
      .filter((message) => message.role === "bot" && message.kind === "text" && String(message.text).includes(text)).length;
    const tasks = async (botId: string): Promise<any[]> => ((await api("GET", "/api/bots?messages=0")).body.bots as any[]).find((one) => one.id === botId)?.tasks ?? [];
    const gate = (name: string) => join(dataDir, `${name}.gate`);
    const open = (name: string) => writeFileSync(gate(name), "open");
    const ready = (name: string) => join(dataDir, `${name}.ready`);
    try {
      await test({ api, dataDir, clive, mira, job: clive.activeTaskId as string, script, askMeFirst, say, roots, children, turns, keys, turn, told, given, replies,
        messages, said, tasks, gate, open, ready });
    } catch (error) {
      const names: Record<string, string> = { [clive.id]: "Clive", [mira.id]: "Mira" };
      console.error(`teammate follow-ups fixture state:\n${JSON.stringify({
        turns: jsonl(`${planPath}.evidence.jsonl`).map((record) => ({ bot: names[record.botId] ?? record.botId, planKey: record.planKey, unplanned: record.unplanned,
          threadId: record.threadId, own: ownTurnText(record.prompt).slice(0, 500) })),
        assignments: assignments(dataDir).map(({ id, parentId, status, outcome, executions, result, question, assignee }) =>
          ({ id, parentId, status, outcome, executions, result, question, threadId: assignee?.destination?.threadId })),
      }, null, 1)}`);
      throw error;
    }
    expect(turns(clive.id).concat(turns(mira.id)).filter((record) => record.unplanned).map((record) => ownTurnText(record.prompt).slice(0, 300))).toEqual([]);
  } finally {
    await session.close();
  }
}


const NOTE = "[From @Clive (bot)";
const NOT_OPENED = (thread: string) => `"${thread}" is not a thread you opened on Mira: use a threadId one of your coordinate_bots receipts gave, or one list_threads shows on them`;
/** The thread's record as saved: its opener, level and always-allow list. */
const record = (f: any, thread: string): any => (JSON.parse(readFileSync(join(f.dataDir, "bots.json"), "utf8")) as any[])
  .find((bot) => bot.id === f.mira.id)?.tasks?.find((task: any) => task.threadId === thread);

it("R1 lands Clive's one-way notice in the thread the person opened on Mira, marked as from Clive, and refuses work that wants a report there", () => scenario(async (f) => {
  const thread = f.mira.activeTaskId as string;
  await expect.poll(() => record(f, thread)?.threadId, { timeout: 15_000 }).toBe(thread);
  expect(record(f, thread).openedBy, "the person opened this thread").toBeUndefined();
  f.script(f.clive.id, { key: "C0", match: ["R1-JOB"], steps: [
    { arguments: { bot_ids: [f.mira.id], message: "R1-NOTICE: the deadline moved to Friday.", thread, reply: "none" } },
    { arguments: { bot_ids: [f.mira.id], message: "R1-WORK: redo the page.", thread }, expectError: true }], reply: "C0: done." });
  f.script(f.mira.id, { key: "M0", match: ["R1-NOTICE"], reply: "M0: noted." });
  await f.say(f.clive.id, f.job, "R1-JOB: tell Mira about the new deadline in her chat with me.");
  await expect.poll(() => f.keys(f.clive.id), { timeout: 30_000 }).toEqual(["C0"]);
  await expect.poll(() => f.keys(f.mira.id), { timeout: 30_000 }).toEqual(["M0"]);
  const [notice, refused] = f.replies("C0");
  expect(notice.receipts).toEqual([expect.objectContaining({ outcome: expect.stringMatching(/queued|injected/), threadId: thread })]);
  expect(refused, "work that wants a report is refused with upstream's words").toBe(NOT_OPENED(thread));
  expect(f.told("M0"), "Mira's turn text says who sent it").toContain(NOTE);
  expect(f.turns(f.mira.id).map((turn: any) => turn.threadId)).toEqual([thread]);
  await expect.poll(async () => await f.said(thread, "M0: noted."), { timeout: 30_000 }).toBe(1);
  const landed = (await f.messages(thread)).filter((message: any) => JSON.stringify(message).includes("R1-NOTICE"));
  expect(landed.map((message: any) => message.from?.botId)).toContain(f.clive.id);
  expect(record(f, thread).openedBy, "the thread keeps its opener").toBeUndefined();
  expect(record(f, thread).outside, "a person's thread is not marked outside").toBeFalsy();
  expect(f.children().map((row: any) => row.reply)).toEqual(["none"]);
  expect(f.children().map((row: any) => row.assignee?.destination?.threadId)).toEqual([thread]);
}), hostTimeout(90_000));

it("R2 leaves the person's thread at its own approval level and always-allow list when a Chief on Full access drops a notice in", () => scenario(async (f) => {
  const thread = f.mira.activeTaskId as string;
  expect((await f.api("PATCH", `/api/bots/${f.clive.id}`, { approvalMode: "full", applyToAllThreads: true })).status).toBe(200);
  expect((await f.api("PATCH", `/api/bots/${f.mira.id}`, { approvalMode: "ask", applyToAllThreads: true })).status).toBe(200);
  expect((await f.api("PATCH", `/api/bots/${f.mira.id}`, { alwaysAllow: ["Bash"] })).status).toBe(200);
  expect((await f.api("PATCH", `/api/bots/${f.mira.id}/tasks/${thread}`, { refreshPermissions: true })).status).toBe(200);
  await expect.poll(() => record(f, thread)?.alwaysAllow, { timeout: 15_000 }).toEqual(["Bash"]);
  const before = record(f, thread);
  expect(before.approvalMode).toBe("ask");
  f.script(f.clive.id, { key: "C0", match: ["R2-JOB"], steps: [{ arguments: { bot_ids: [f.mira.id], message: "R2-NOTICE: the deadline moved.", thread, reply: "none" } }], reply: "C0: done." });
  f.script(f.mira.id, { key: "M0", match: ["R2-NOTICE"], reply: "M0: noted." });
  await f.say(f.clive.id, f.job, "R2-JOB: tell Mira about the deadline.");
  await expect.poll(() => f.keys(f.mira.id), { timeout: 30_000 }).toEqual(["M0"]);
  await expect.poll(async () => await f.said(thread, "M0: noted."), { timeout: 30_000 }).toBe(1);
  expect(record(f, thread)).toMatchObject({ approvalMode: "ask", alwaysAllow: ["Bash"] });
  expect((await f.messages(thread)).filter((message: any) => / — handed on by /.test(message.tool?.name ?? ""))).toEqual([]);
}), hostTimeout(90_000));

it("R3 refuses a notice from a Clive turn a webhook or a routine started, with upstream's words, and leaves the thread unmarked", () => scenario(async (f) => {
  const thread = f.mira.activeTaskId as string;
  await expect.poll(() => record(f, thread)?.threadId, { timeout: 15_000 }).toBe(thread);
  const notice = (key: string) => ({ key, match: [`${key}-RUN`], steps: [{ arguments: { bot_ids: [f.mira.id], message: "Keep it", thread, reply: "none" }, expectError: true }], reply: `${key}: refused.` });
  f.script(f.clive.id, notice("R3-HOOK"), notice("R3-ROUTINE"));
  const hook = await f.api("POST", "/api/webhooks", { name: "R3", prompt: "R3-HOOK-RUN: tell Mira to keep it.", botId: f.clive.id, runOn: "maus" });
  expect(hook.status, JSON.stringify(hook.body)).toBe(201);
  expect((await fetch(hook.body.credential.url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(202);
  await expect.poll(() => f.keys(f.clive.id), { timeout: 30_000 }).toEqual(["R3-HOOK"]);
  const routine = await f.api("POST", "/api/routines", { name: "R3", prompt: "R3-ROUTINE-RUN: tell Mira to keep it.", botId: f.clive.id, schedule: { type: "daily", time: "09:00", weekdays: [1] } });
  expect(routine.status, JSON.stringify(routine.body)).toBe(201);
  expect((await f.api("POST", `/api/routines/${routine.body.routine.id}/run`)).status).toBe(201);
  await expect.poll(() => f.keys(f.clive.id), { timeout: 30_000 }).toEqual(["R3-HOOK", "R3-ROUTINE"]);
  expect(f.replies("R3-HOOK")).toEqual([NOT_OPENED(thread)]);
  expect(f.replies("R3-ROUTINE")).toEqual([NOT_OPENED(thread)]);
  expect(f.keys(f.mira.id)).toEqual([]);
  expect(f.children()).toEqual([]);
  expect(record(f, thread).outside, "the refused turn did not mark the person's thread outside").toBeFalsy();
}), hostTimeout(90_000));

it("R4 refuses a notice into a thread that waits on the person's answer, and the card stays theirs", () => scenario(async (f) => {
  await f.askMeFirst();
  const thread = f.mira.activeTaskId as string;
  const question = "Keep the old pricing page as a backup?";
  f.script(f.mira.id, { key: "M1", match: ["R4"], timeoutMs: 90_000,
    steps: [{ server: "ogb", tool: "ask_user", arguments: { question, choices: ["Keep it", "Delete it"] }, capture: { answer: "([\\s\\S]+)" } }], reply: "R4-RESULT: done with {{answer}}" });
  f.script(f.clive.id, { key: "C0", match: ["R4-SAG"], steps: [{ arguments: { bot_ids: [f.mira.id], message: "Keep it", thread, reply: "none" }, expectError: true }], reply: "C0: refused." });
  await f.say(f.mira.id, thread, "R4: redo the pricing page.");
  const card = async () => (await f.messages(thread)).find((message: any) => message.card?.subtitle === question)?.card;
  await expect.poll(async () => (await card()) !== undefined, { timeout: 30_000 }).toBe(true);
  await f.say(f.clive.id, f.job, "R4-SAG: let Mira know.");
  await expect.poll(() => f.keys(f.clive.id), { timeout: 30_000 }).toEqual(["C0"]);
  expect(f.replies("C0")).toEqual([WAITS_ON_PERSON]);
  expect((await card())?.answered).toBeUndefined();
  expect(f.children()).toEqual([]);
}), hostTimeout(90_000));
