// suyuan fork: end-to-end tests for optional per-handoff model_selection on coordinate_bots.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb } from "../../scripts/control-omb.ts";
import { hostTimeout } from "../testing/host-timeout.ts";
import { ownTurnText } from "../testing/room-handoff-agent.ts";

const jsonl = (path: string): any[] => existsSync(path)
  ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];

const receiptThreadId = (text: string | undefined): string => {
  try {
    const parsed = JSON.parse(text ?? "") as { receipts?: Array<{ threadId?: string }> };
    return parsed.receipts?.[0]?.threadId ?? "";
  } catch {
    return "";
  }
};

async function scenario(
  test: (f: any) => Promise<void>,
  options: { extraProviders?: Array<"codex" | "cline" | "copilot" | "customAcp"> } = {},
) {
  const session = await launchVerificationServer(
    { ...process.env },
    undefined,
    undefined,
    undefined,
    undefined,
    { scripted: true },
    options.extraProviders ?? [],
  );
  const { url, dataDir, logPath } = session.info;
  try {
    const api = async (method: string, path: string, body?: unknown) => {
      const response = await fetch(`${url}${path}`, {
        method,
        headers: { "content-type": "application/json", origin: url },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20_000),
      });
      const raw = await response.text();
      let parsed: any = raw;
      try { parsed = JSON.parse(raw); } catch {}
      return { status: response.status, body: parsed };
    };
    const bot = async (name: string, section: string) =>
      ((await runControlOmb(["new-bot", "--name", name, "--section", section, "--url", url])) as any).bot;
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
    const turns = (botId: string): any[] => jsonl(`${planPath}.evidence.jsonl`).filter((turn) => turn.botId === botId);
    const keys = (botId: string) => turns(botId).map((turn) => turn.planKey);
    const turn = (key: string) => jsonl(`${planPath}.evidence.jsonl`).find((candidate) => candidate.planKey === key);
    const stepTexts = (key: string): string[] => (turn(key)?.evidence ?? []).filter((entry: any) => entry?.step)
      .map((entry: any) => String(entry.response.result?.content?.[0]?.text ?? entry.response.error?.message ?? ""));
    const botState = async (botId: string): Promise<any> =>
      ((await api("GET", "/api/bots?messages=0")).body.bots as any[]).find((one) => one.id === botId);
    const gate = (name: string) => join(dataDir, `${name}.gate`);
    const open = (name: string) => writeFileSync(gate(name), "open");
    const ready = (name: string) => join(dataDir, `${name}.ready`);
    try {
      await test({ api, dataDir, logPath, url, clive, mira, job: clive.activeTaskId as string, script, say, turns, keys, turn, stepTexts, botState, gate, open, ready });
    } catch (error) {
      const names: Record<string, string> = { [clive.id]: "Clive", [mira.id]: "Mira" };
      console.error(`handoff-model fixture state:\n${JSON.stringify({
        turns: jsonl(`${planPath}.evidence.jsonl`).map((record) => ({
          bot: names[record.botId] ?? record.botId,
          planKey: record.planKey,
          unplanned: record.unplanned,
          model: record.model,
          threadId: record.threadId,
          own: ownTurnText(record.prompt).slice(0, 400),
          steps: (record.evidence ?? []).filter((entry: any) => entry?.step)
            .map((entry: any) => String(entry.response.result?.content?.[0]?.text ?? JSON.stringify(entry.response.error ?? "")).slice(0, 300)),
        })),
      }, null, 1)}`);
      throw error;
    }
    expect(turns(clive.id).concat(turns(mira.id)).filter((record) => record.unplanned).map((record) => ownTurnText(record.prompt).slice(0, 300))).toEqual([]);
  } finally {
    await session.close();
  }
}

it("standing override runs on chosen model, leaves teammate default unchanged, and resets on the next default hand-off", () => scenario(async (f) => {
  const defaultModel = f.mira.modelSelection.model as string;
  const altModel = defaultModel === "claude-sonnet-5-5" ? "claude-opus-5-5" : "claude-sonnet-5-5";

  f.script(f.clive.id,
    {
      key: "C1",
      match: ["TASK-ONE"],
      steps: [{
        arguments: {
          bot_ids: [f.mira.id],
          message: "M1-WORK: run on override.",
          model_selection: { instanceId: "claude", model: altModel },
        },
      }],
      reply: "C1: dispatched override.",
    },
    { key: "C2", match: ["M1-DONE"], reply: "C2: first job done." },
    {
      key: "C3",
      match: ["TASK-TWO"],
      steps: [{
        arguments: {
          bot_ids: [f.mira.id],
          message: "M2-WORK: run on default.",
        },
      }],
      reply: "C3: dispatched default.",
    },
    { key: "C4", match: ["M2-DONE"], reply: "C4: all done." });
  f.script(f.mira.id,
    { key: "M1", match: ["M1-WORK"], reply: "M1-DONE: override finished." },
    { key: "M2", match: ["M2-WORK"], reply: "M2-DONE: default finished." });

  await f.say(f.clive.id, f.job, "TASK-ONE: send Mira a job on an alternate model.");
  await expect.poll(() => f.keys(f.clive.id), { timeout: 60_000 }).toEqual(["C1", "C2"]);
  await f.say(f.clive.id, f.job, "TASK-TWO: now send Mira a normal job.");
  await expect.poll(() => f.keys(f.clive.id), { timeout: 60_000 }).toEqual(["C1", "C2", "C3", "C4"]);
  await expect.poll(() => f.keys(f.mira.id), { timeout: 30_000 }).toEqual(["M1", "M2"]);

  expect(f.turn("M1").model).toBe(altModel);
  expect(f.turn("M2").model).toBe(defaultModel);
  expect(f.turn("M2").threadId, "second call reuses the standing thread").toBe(f.turn("M1").threadId);
  expect(f.stepTexts("C1")[0]).toContain(`[model: claude/${altModel}]`);
  expect(f.stepTexts("C3")[0]).not.toContain("[model:");
  expect((await f.botState(f.mira.id)).modelSelection).toEqual(f.mira.modelSelection);
}), hostTimeout(120_000));

it("fresh thread with model_selection keeps its override across explicit thread follow-ups", () => scenario(async (f) => {
  const defaultModel = f.mira.modelSelection.model as string;
  const altModel = defaultModel === "claude-sonnet-5-5" ? "claude-opus-5-5" : "claude-sonnet-5-5";

  f.script(f.clive.id,
    {
      key: "C1",
      match: ["FRESH-START"],
      steps: [{
        arguments: {
          bot_ids: [f.mira.id],
          thread: "new",
          title: "Alt model thread",
          message: "FRESH-M1: first pass.",
          model_selection: { instanceId: "claude", model: altModel },
        },
      }],
      reply: "C1: opened fresh override thread.",
    },
    { key: "C3", match: ["FRESH-M2-DONE"], reply: "C3: finished." });
  f.script(f.mira.id,
    { key: "M1", match: ["FRESH-M1"], gateFile: f.gate("m1"), reply: "FRESH-M1-DONE." },
    { key: "M2", match: ["FRESH-M2"], reply: "FRESH-M2-DONE." });

  await f.say(f.clive.id, f.job, "FRESH-START");
  await expect.poll(() => f.keys(f.clive.id), { timeout: 60_000 }).toContain("C1");
  const opened = receiptThreadId(f.stepTexts("C1")[0]);
  expect(opened, f.stepTexts("C1")[0]).not.toBe("");

  f.script(f.clive.id, {
    key: "C2",
    match: ["FRESH-M1-DONE"],
    steps: [{
      arguments: {
        bot_ids: [f.mira.id],
        thread: opened,
        rework: true,
        message: "FRESH-M2: follow up without re-passing model_selection.",
      },
    }],
    reply: "C2: followed up.",
  });
  f.open("m1");

  await expect.poll(() => f.keys(f.clive.id), { timeout: 60_000 }).toEqual(["C1", "C2", "C3"]);
  expect(f.turn("M1").threadId).toBe(opened);
  expect(f.turn("M2").threadId).toBe(opened);
  expect(f.turn("M1").model).toBe(altModel);
  expect(f.turn("M2").model, "explicit thread follow-up retains thread override").toBe(altModel);
  expect((await f.botState(f.mira.id)).modelSelection).toEqual(f.mira.modelSelection);
}), hostTimeout(120_000));

it("busy standing thread refuses a conflicting model_selection while allowing a model-less follow-up", () => scenario(async (f) => {
  const defaultModel = f.mira.modelSelection.model as string;
  const altModel = defaultModel === "claude-sonnet-5-5" ? "claude-opus-5-5" : "claude-sonnet-5-5";

  f.script(f.clive.id,
    {
      key: "C1",
      match: ["START-BUSY"],
      steps: [{
        arguments: {
          bot_ids: [f.mira.id],
          message: "BUSY-M1: hold the thread.",
          model_selection: { instanceId: "claude", model: altModel },
        },
      }],
      reply: "C1: started Mira.",
    },
    {
      key: "C2",
      match: ["TRY-CONFLICT"],
      steps: [{
        expectError: true,
        arguments: {
          bot_ids: [f.mira.id],
          message: "CONFLICTING-MODEL: should be refused.",
          model_selection: { instanceId: "claude", model: defaultModel },
        },
      }],
      reply: "C2: conflict refused.",
    },
    {
      key: "C3",
      match: ["TRY-STEER"],
      steps: [{
        arguments: {
          bot_ids: [f.mira.id],
          message: "STEER-NOTE: keep going on current model.",
        },
      }],
      reply: "C3: steered.",
    },
    { key: "C4", match: ["BUSY-M1-DONE"], reply: "C4: received final result." });
  f.script(f.mira.id,
    { key: "M1", match: ["BUSY-M1"], readyFile: f.ready("m1"), gateFile: f.gate("m1"), reply: "BUSY-M1-DONE." });

  await f.say(f.clive.id, f.job, "START-BUSY");
  await expect.poll(() => existsSync(f.ready("m1")), { timeout: 60_000 }).toBe(true);

  await f.say(f.clive.id, f.job, "TRY-CONFLICT");
  await expect.poll(() => f.keys(f.clive.id), { timeout: 60_000 }).toEqual(["C1", "C2"]);
  const refused = f.stepTexts("C2")[0] ?? "";
  expect(refused).toContain("busy or queued");
  expect(refused).toContain('thread "new"');

  await f.say(f.clive.id, f.job, "TRY-STEER");
  await expect.poll(() => f.keys(f.clive.id), { timeout: 60_000 }).toEqual(["C1", "C2", "C3"]);
  const steered = f.stepTexts("C3")[0] ?? "";
  expect(steered).not.toContain("busy or queued");

  f.open("m1");
  await expect.poll(() => f.keys(f.clive.id), { timeout: 60_000 }).toContain("C4");
  expect(f.turn("M1").model).toBe(altModel);
}), hostTimeout(120_000));

it("cross-engine override runs a codex-default teammate on claude without changing its default, lists engine in list_bots, and refuses invalid selections", () => scenario(async (f) => {
  await runControlOmb(["set-model", "--bot", f.mira.id, "--instance", "codex", "--model", "gpt-fake-default", "--url", f.url]);
  expect((await f.botState(f.mira.id)).modelSelection).toEqual({ instanceId: "codex", model: "gpt-fake-default" });

  f.script(f.clive.id,
    {
      key: "C1",
      match: ["CHECK-ROSTER"],
      steps: [
        { tool: "list_bots", arguments: {} },
        {
          expectError: true,
          arguments: {
            bot_ids: [f.mira.id],
            message: "BAD-MODEL",
            model_selection: { instanceId: "claude", model: "no-such-model" },
          },
        },
      ],
      reply: "C1: checked roster and invalid model.",
    },
    {
      key: "C2",
      match: ["CROSS-ENGINE"],
      steps: [{
        arguments: {
          bot_ids: [f.mira.id],
          message: "CROSS-M1: run on claude instead of codex.",
          model_selection: { instanceId: "claude", model: "claude-sonnet-5-5" },
        },
      }],
      reply: "C2: dispatched cross-engine.",
    },
    { key: "C3", match: ["CROSS-M1-DONE"], reply: "C3: got cross-engine reply." });
  f.script(f.mira.id,
    { key: "M1", match: ["CROSS-M1"], reply: "CROSS-M1-DONE: ran on claude." });

  await f.say(f.clive.id, f.job, "CHECK-ROSTER");
  await expect.poll(() => f.keys(f.clive.id), { timeout: 60_000 }).toEqual(["C1"]);
  const [roster, badModel] = f.stepTexts("C1");
  expect(roster).toContain("engine: codex");
  expect(badModel).toContain('model "no-such-model" is not offered by instance "claude"');

  await f.say(f.clive.id, f.job, "CROSS-ENGINE");
  await expect.poll(() => f.keys(f.clive.id), { timeout: 60_000 }).toEqual(["C1", "C2", "C3"]);

  expect(f.stepTexts("C2")[0]).toContain("[model: claude/claude-sonnet-5-5]");
  expect(f.turn("M1").model).toBe("claude-sonnet-5-5");
  expect((await f.botState(f.mira.id)).modelSelection).toEqual({ instanceId: "codex", model: "gpt-fake-default" });
}, { extraProviders: ["codex"] }), hostTimeout(120_000));
