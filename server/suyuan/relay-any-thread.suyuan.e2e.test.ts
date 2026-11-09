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

it("R1 lands Clive's one-way notice in the thread the person opened on Mira, marked as from Clive, and refuses work that wants a report there", () => scenario(async (f) => {
  const thread = f.mira.activeTaskId as string;
  const record = () => (JSON.parse(readFileSync(join(f.dataDir, "bots.json"), "utf8")) as any[]).find((bot) => bot.id === f.mira.id)?.tasks?.find((task: any) => task.threadId === thread);
  await expect.poll(() => record()?.threadId, { timeout: 15_000 }).toBe(thread);
  const before = record().openedBy;
  expect(before, "the person opened this thread").toBeUndefined();
  f.script(f.clive.id, { key: "C0", match: ["R1-JOB"], steps: [
    { arguments: { bot_ids: [f.mira.id], message: "R1-NOTICE: the deadline moved to Friday.", thread, reply: "none" } },
    { arguments: { bot_ids: [f.mira.id], message: "R1-WORK: redo the page.", thread }, expectError: true }], reply: "C0: done." });
  f.script(f.mira.id, { key: "M0", match: ["R1-NOTICE"], reply: "M0: noted." });
  await f.say(f.clive.id, f.job, "R1-JOB: tell Mira about the new deadline in her chat with me.");
  await expect.poll(() => f.keys(f.clive.id), { timeout: 30_000 }).toEqual(["C0"]);
  await expect.poll(() => f.keys(f.mira.id), { timeout: 30_000 }).toEqual(["M0"]);
  const [notice, refused] = f.replies("C0");
  expect(notice.receipts).toEqual([expect.objectContaining({ outcome: expect.stringMatching(/queued|injected/), threadId: thread })]);
  expect(refused).toBe(`"${thread}" was opened by someone else: to a thread you did not open, send only a one-way notice (reply "none"); to hand Mira work, use thread "standing" or "new"`);
  expect(f.given("M0")).toContain(NOTE);
  expect(f.turns(f.mira.id).map((record: any) => record.threadId)).toEqual([thread]);
  await expect.poll(async () => await f.said(thread, "M0: noted."), { timeout: 30_000 }).toBe(1);
  expect(record().openedBy, "the thread keeps its opener").toEqual(before);
  expect(f.children().map((row: any) => row.reply)).toEqual(["none"]);
  expect(f.children().map((row: any) => row.assignee?.destination?.threadId)).toEqual([thread]);
}), hostTimeout(90_000));
