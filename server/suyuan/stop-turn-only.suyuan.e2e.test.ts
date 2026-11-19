// suyuan fork (stop-turn-only.ts), on one server of the person's own with the scripted fake engine: the person presses
// Stop while the bot's turn still runs after it opened a thread on itself and handed work to a teammate. Only that turn
// ends; the thread and the teammate run on, and their results resume the conversation. A typed 「停」 ends everything,
// as upstream's Stop did.
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


async function scenario(test: (f: any) => Promise<void>, env: NodeJS.ProcessEnv = {}) {
  const session = await launchVerificationServer({ ...process.env, ...env }, undefined, undefined, undefined, undefined, { scripted: true });
  const { url, dataDir, logPath } = session.info;
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
      await test({ api, dataDir, logPath, url, clive, mira, job: clive.activeTaskId as string, script, say, children, turns, keys, turn, told, stepTexts, messages, tasks, gate, open, ready });
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

const OWN = "here is you: you opened this thread yourself";

/** The opening turn hands out two pieces of work, then holds (as a long tool call would) until it is stopped. */
function handOut(f: any, tag: string) {
  // The thread's own turn and the resumed one read the person's words too, so their entries come first.
  f.script(f.clive.id,
    { key: "K1", match: [`${tag}-CHILD`, OWN], readyFile: f.ready("k1"), gateFile: f.gate("k1"), timeoutMs: 120_000, reply: "K1-RESULT: collage done." },
    { key: "C1", match: ["K1-RESULT"], reply: "C1: results are in." },
    { key: "C2", match: ["M1-RESULT"], reply: "C2: caption is in." },
    { key: "C0", match: [`${tag}-JOB`], steps: [
      { tool: "start_thread", arguments: { title: `${tag} collage`, message: `${tag}-CHILD: make the collage.` } },
      { arguments: { bot_ids: [f.mira.id], message: `${tag}-COPY: write the caption.` } }],
      readyFile: f.ready("c0"), gateFile: f.gate("c0"), timeoutMs: 120_000, reply: "C0: should never finish." });
  f.script(f.mira.id,
    { key: "M1", match: [`${tag}-COPY`], readyFile: f.ready("m1"), gateFile: f.gate("m1"), timeoutMs: 120_000, reply: "M1-RESULT: caption done." });
}

async function handedOut(f: any, tag: string) {
  await f.say(f.clive.id, f.job, `${tag}-JOB: make the collage in a thread of your own, and have Mira write the caption.`);
  for (const name of ["c0", "k1", "m1"]) await expect.poll(() => existsSync(f.ready(name)), { timeout: 60_000, message: `${name} is ready` }).toBe(true);
  await expect.poll(() => f.children().map((row: any) => row.status), { timeout: 30_000 }).toEqual(["running", "running"]);
}

const root = (f: any) => assignments(f.dataDir).find((row) => !row.parentId && row.assignee?.destination?.threadId === f.job);
/** The stopped conversation's own turn, not the bot: its opened thread may still be running. */
const busy = async (f: any) => (await f.tasks(f.clive.id)).find((task: any) => task.threadId === f.job)?.busy === true;

it("Stop while the turn runs ends only that turn: the opened thread and the teammate finish and report back", () => scenario(async (f) => {
  handOut(f, "T1");
  await handedOut(f, "T1");
  const stopped = await f.api("POST", `/api/bots/${f.clive.id}/interrupt`, { threadId: f.job });
  expect(stopped.status, JSON.stringify(stopped.body)).toBe(200);
  await expect.poll(() => busy(f), { timeout: 30_000 }).toBe(false);
  await expect.poll(() => root(f)?.status, { timeout: 15_000 }).toBe("waiting");
  expect(f.children().map((row: any) => row.status), "nothing handed out was stopped").toEqual(["running", "running"]);
  expect((await f.messages(f.job)).some((message: any) => String(message.tool?.name ?? "").includes("Stopped with the request it was for"))).toBe(false);

  f.open("k1"); f.open("m1");
  await expect.poll(() => f.children().map((row: any) => row.status), { timeout: 60_000 }).toEqual(["completed", "completed"]);
  await expect.poll(() => f.keys(f.clive.id).some((key: string) => key === "C1" || key === "C2"), { timeout: 60_000 }).toBe(true);
  const resumed = f.turn("C1") ?? f.turn("C2");
  expect(resumed.threadId, "the results come back to the conversation that was stopped").toBe(f.job);
  const told = () => [f.turn("C1"), f.turn("C2")].filter(Boolean).map((turn: any) => ownTurnText(turn.prompt)).join("\n");
  await expect.poll(told, { timeout: 30_000 }).toContain("M1-RESULT");
  expect(told()).toContain("K1-RESULT");
  await expect.poll(() => root(f)?.status, { timeout: 30_000 }).toBe("completed");
}), hostTimeout(240_000));

it("a typed 「停」 while the turn runs still ends everything it handed out", () => scenario(async (f) => {
  handOut(f, "T2");
  await handedOut(f, "T2");
  await f.say(f.clive.id, f.job, "停");
  await expect.poll(() => f.children().map((row: any) => [row.status, row.outcomeDetail]), { timeout: 30_000 })
    .toEqual([["cancelled", "Stopped with the request it was for"], ["cancelled", "Stopped with the request it was for"]]);
  expect(root(f)).toMatchObject({ status: "cancelled", outcome: "stopped" });
  await expect.poll(() => busy(f), { timeout: 30_000 }).toBe(false);
  f.open("k1"); f.open("m1");
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  expect(f.keys(f.clive.id).filter((key: string) => key === "C1" || key === "C2"), "nothing resumes a conversation the person stopped").toEqual([]);
}), hostTimeout(180_000));
