// suyuan fork: on a real server with the fake engine, a routine run twice leaves one conversation, with both runs in it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../../scripts/control-omb.ts";
import { FRESH_RUN_NOTE } from "./routine-thread.ts";

// The engine exits after each turn, so the next run in a conversation starts it again with --resume.
const RESUMING = { ...process.env, OMB_ROUTINE_ONE_THREAD: "1", FAKE_CLAUDE_EXIT_AFTER_TURN: "1" };
const SHARING = { ...process.env, OMB_ROUTINE_ONE_THREAD: "1" };

it("runs a routine twice into one conversation, and opens a new one after that conversation is deleted", async () => {
  const fixture = await launchVerificationServer(RESUMING);
  const url = fixture.info.url;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json() as any;
    expect(response.ok, `${method} ${path}: ${JSON.stringify(value)}`).toBe(true);
    return value;
  };
  try {
    const { bot } = await runControlOmb(["new-bot", "--name", "One thread fixture", "--url", url]) as any;
    const { routine } = await api("POST", "/api/routines", {
      name: "Hourly outfit", prompt: "Pick an outfit.", botId: bot.id, enabled: false,
      continuity: true, schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 },
    });
    const dump = () => JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8"));
    const run = async () => {
      const { run } = await api("POST", `/api/routines/${routine.id}/run`);
      await expect.poll(async () => (await api("GET", "/api/routines")).runs.find((item: any) => item.id === run.id)?.status, { timeout: 15_000 }).toBe("completed");
      return (await api("GET", "/api/routines")).runs.find((item: any) => item.id === run.id);
    };
    const tasks = async () => (await api("GET", "/api/bots")).bots.find((candidate: any) => candidate.id === bot.id).tasks as any[];
    const before = (await tasks()).length;
    const first = await run();
    const second = await run();
    expect(second.threadId).toBe(first.threadId);
    // The earlier report is already in the resumed context, so it is not carried in a second time.
    expect(dump().argv).toContain("--resume");
    expect(JSON.stringify(dump().prompt)).not.toContain("<previous-run");
    // It is told the earlier run above is history, so a step that failed there is tried again.
    expect(JSON.stringify(dump().prompt)).toContain(JSON.stringify(FRESH_RUN_NOTE).slice(1, -1));
    // The conversation is marked as the second run's, and stays read.
    expect((await tasks()).find((task) => task.threadId === first.threadId)).toMatchObject({ routineRunId: second.id, unread: false });
    expect(await tasks()).toHaveLength(before + 1);
    expect((await tasks()).find((task) => task.threadId === first.threadId).title).toBe("Hourly outfit");
    const { messages } = await api("GET", `/api/threads/${first.threadId}/messages?limit=100`);
    expect(messages.filter((message: any) => message.role === "user")).toHaveLength(2);
    expect(messages.filter((message: any) => message.role === "bot" && message.text === "hello from fake claude")).toHaveLength(2);

    await api("DELETE", `/api/bots/${bot.id}/tasks/${first.threadId}`);
    const third = await run();
    expect(third.threadId).not.toBe(first.threadId);
    expect(await tasks()).toHaveLength(before + 1);
    expect((await run()).threadId).toBe(third.threadId);
  } finally {
    await fixture.close();
  }
}, 90_000);

it("runs a webhook twice into one conversation", async () => {
  const fixture = await launchVerificationServer(SHARING);
  const url = fixture.info.url;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json() as any;
    expect(response.ok, `${method} ${path}: ${JSON.stringify(value)}`).toBe(true);
    return value;
  };
  try {
    const { bot } = await runControlOmb(["new-bot", "--name", "Webhook fixture", "--url", url]) as any;
    const hook = await api("POST", "/api/webhooks", { name: "Crew chat", prompt: "Reply with one line.", botId: bot.id });
    const tasks = async () => (await api("GET", "/api/bots")).bots.find((candidate: any) => candidate.id === bot.id).tasks as any[];
    const before = (await tasks()).length;
    const call = async (n: number) => {
      const response = await fetch(hook.credential.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ n }) });
      expect(response.status).toBe(202);
      const { runId } = await response.json() as { runId: string };
      await expect.poll(async () => (await api("GET", "/api/routines")).runs.find((item: any) => item.id === runId)?.status, { timeout: 30_000 }).toBe("completed");
      return (await api("GET", "/api/routines")).runs.find((item: any) => item.id === runId);
    };
    const first = await call(1);
    const second = await call(2);
    expect(second.threadId).toBe(first.threadId);
    expect(await tasks()).toHaveLength(before + 1);
    expect((await tasks()).find((task) => task.threadId === first.threadId).title).toBe("Crew chat");
  } finally {
    await fixture.close();
  }
}, 90_000);

it("shows the second run's approval card in the bot's main conversation, though both runs share one", async () => {
  const fixture = await launchVerificationServer(RESUMING);
  const url = fixture.info.url;
  let broker: Socket | undefined;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json() as any;
    expect(response.ok, `${method} ${path}: ${JSON.stringify(value)}`).toBe(true);
    return value;
  };
  const state = async (id: string) => (await api("GET", "/api/routines")).runs.find((item: any) => item.id === id);
  const messages = async (id: string) => (await api("GET", `/api/threads/${id}/messages?limit=100`)).messages as any[];
  try {
    const { bot } = await runControlOmb(["new-bot", "--name", "Approval fixture", "--url", url]) as any;
    await api("PATCH", `/api/bots/${bot.id}`, { approvalMode: "ask" });
    const main = (await api("GET", "/api/bots")).bots.find((candidate: any) => candidate.id === bot.id).threadId;
    const { routine } = await api("POST", "/api/routines", {
      name: "Asks first", prompt: "Report.", botId: bot.id, enabled: false,
      schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 },
    });
    const { run: first } = await api("POST", `/api/routines/${routine.id}/run`);
    await expect.poll(async () => (await state(first.id))?.status, { timeout: 15_000 }).toBe("completed");
    const gate = join(fixture.info.dataDir, "finish");
    const wrapper = join(fixture.info.dataDir, "slow.mjs");
    writeFileSync(wrapper, [
      "#!/usr/bin/env node",
      'process.env.FAKE_CLAUDE_MODE = "slow";',
      `process.env.FAKE_CLAUDE_SLOW_FINISH_GATE = ${JSON.stringify(gate)};`,
      `await import(${JSON.stringify(pathToFileURL(join(process.cwd(), "server/testing/fake-claude-cli.ts")).href)});`,
    ].join("\n"), { mode: 0o700 });
    await api("PATCH", "/api/instances/claude", { cli: wrapper });
    const { run: second } = await api("POST", `/api/routines/${routine.id}/run`);
    await expect.poll(async () => (await state(second.id))?.status, { timeout: 15_000 }).toBe("running");
    const active = await state(second.id);
    expect(active.threadId).toBe((await state(first.id)).threadId);
    await expect.poll(() => existsSync(fixture.fixtureDumpPath) &&
      JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")).mcpConfig?.mcpServers?.agents?.env?.OMB_THREAD_ID === active.threadId, { timeout: 15_000 }).toBe(true);
    const launched = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8"));
    broker = connect(launched.mcpConfig.mcpServers.ogb.args.at(-1));
    broker.on("error", () => {});
    await new Promise<void>((resolve, reject) => { broker!.once("connect", resolve); broker!.once("error", reject); });
    broker.write(JSON.stringify({ t: "ask", id: "approval-1", kind: "permission", tool: "Bash", input: { command: "echo fixture-approval" } }) + "\n");
    await expect.poll(async () => (await state(second.id))?.status, { timeout: 15_000 }).toBe("waiting");
    const approval = (await messages(active.threadId)).find((message) => message.card && !message.card.answered);
    expect(approval?.card.tool).toBe("Bash");
    await expect.poll(async () => (await messages(main)).find((message) => message.automation?.runId === second.id), { timeout: 15_000 })
      .toMatchObject({ kind: "options", card: { tool: "Bash", requestId: approval.card.requestId }, automation: { needsYou: true, executionThreadId: active.threadId } });
    await api("POST", `/api/bots/${bot.id}/respond`, { threadId: active.threadId, requestId: approval.card.requestId, behavior: "deny" });
    writeFileSync(gate, "complete the turn");
    await expect.poll(async () => (await state(second.id))?.status, { timeout: 15_000 }).toBe("completed");
  } finally {
    broker?.destroy();
    await fixture.close();
  }
}, 90_000);
