// suyuan fork: the real server, a fake Claude and a fake Codex that dump what they were sent, a fake MCP server named lcu and an
// inert built-in browser. Listing lcu in config.json screenMcpServers changes what a turn is told and what it pins.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { freePortBlock } from "../testing/ports.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FAKE_MCP = join(ROOT, "server/testing/fake-mcp-server.ts");

describe.skipIf(process.platform === "win32")("a bot with lcu, on Auto, against the real server", () => {
  let home = "", data = "", dumpFile = "", codexDumpFile = "", base = "", output = "";
  let child: ChildProcess | null = null;

  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(base + path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBeLessThan(400);
    return result;
  };
  async function until<T>(read: () => T | Promise<T>, accept: (value: T) => boolean): Promise<T> {
    const end = Date.now() + 30_000;
    for (;;) {
      const value = await read();
      if (accept(value)) return value;
      if (Date.now() >= end) throw new Error(`wait expired: ${JSON.stringify(value)}\n${output.slice(-3000)}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  const config = (extra: Record<string, unknown>) => writeFileSync(join(data, "config.json"), JSON.stringify({
    instances: {
      claude: { driver: "claudeAgent", config: { cli: join(ROOT, "server/testing/fake-claude-cli.ts") }, environment: { FAKE_CLAUDE_DUMP: dumpFile } },
      codex: { driver: "codex", config: { cli: join(ROOT, "server/testing/fake-codex-app-server.ts") }, environment: { FAKE_CODEX_DUMP: codexDumpFile, FAKE_CODEX_DUMP_TURNS_ONLY: "1" } },
    },
    mcpServers: { lcu: { command: process.execPath, args: ["--experimental-strip-types", FAKE_MCP], enabled: true } },
    ...extra,
  }));
  const savedTask = (botId: string, threadId: string) =>
    (JSON.parse(readFileSync(join(data, "bots.json"), "utf8")) as any[]).find((bot) => bot.id === botId)?.tasks.find((task: any) => task.threadId === threadId);
  /** One turn in the thread: what the fake Claude was launched with, once the thread is idle again. */
  const turn = async (botId: string, threadId: string) => {
    rmSync(dumpFile, { force: true });
    await api("POST", `/api/bots/${botId}/messages`, { text: "看一下京东购物车。", threadId });
    const sent = await until<any>(() => {
      if (!existsSync(dumpFile)) return null;
      try { return JSON.parse(readFileSync(dumpFile, "utf8")); } catch { return null; }
    }, Boolean);
    await until(() => api("GET", "/api/bots?messages=0").then(({ bots }) => bots.find((bot: any) => bot.id === botId)?.tasks.find((task: any) => task.threadId === threadId)), (task) => Boolean(task) && !task.busy);
    return { prompt: String(sent.systemPrompt), servers: Object.keys(sent.mcpConfig.mcpServers) };
  };
  async function start() {
    const port = await freePortBlock([0, 1]);
    base = `http://127.0.0.1:${port}`;
    const inertBrowser = join(home, "agent-browser");
    const proc = spawn(process.execPath, ["--import", pathToFileURL(join(ROOT, "server/testing/group-local-vm-hooks.mjs")).href, join(ROOT, "server/index.ts")], {
      cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: {
        PATH: dirname(process.execPath), HOME: home, USERPROFILE: home, OMB_DATA_DIR: data, TMPDIR: home,
        OMB_PORT: String(port), OMB_WEBHOOK_PORT: String(port + 1), OMB_TEST_VM_STATE: join(home, "vm.json"), OMB_USER_DATA: join(home, "user-data"),
        OMB_AGENT_BROWSER_PATH: inertBrowser, AGENT_BROWSER_EXECUTABLE_PATH: inertBrowser,
      },
    });
    child = proc;
    proc.stdout!.on("data", (chunk) => { output += chunk; });
    proc.stderr!.on("data", (chunk) => { output += chunk; });
    await until(async () => {
      if (proc.exitCode !== null) throw new Error(`server exited during boot:\n${output}`);
      try { return (await fetch(base + "/api/health")).ok; } catch { return false; }
    }, Boolean);
    // The seeded bot is its team's Chief, whose own turn about a teammate's problem would overwrite the dump under test.
    const seeded = (await api("GET", "/api/bots?messages=0")).bots.find((bot: any) => bot.chiefOfStaff);
    if (seeded) await api("PATCH", `/api/bots/${seeded.id}`, { chiefOfStaff: false });
  }
  async function stop() {
    if (!child) return;
    const proc = child;
    child = null;
    await waitForExit(proc, { signal: "SIGTERM" });
  }

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), "omb-screen-mcp-"));
    data = join(home, "data");
    dumpFile = join(home, "dump.json");
    codexDumpFile = join(home, "codex-dump.json");
    mkdirSync(data);
    // As on his server: no Local VM a turn on Auto could attach, so the built-in browser is the one place mounted.
    writeFileSync(join(home, "vm.json"), JSON.stringify({ failed: true }));
    writeFileSync(join(home, "agent-browser"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  });
  afterAll(async () => {
    await stop();
    if (home) await removeTempDir(home);
  });

  it("is told lcu comes first and is never pinned to the built-in browser, once config.json lists lcu", async () => {
    // Before: as upstream. The turn has lcu and the built-in browser, is told the browser is everything, and pins it.
    config({});
    await start();
    const { bot } = await api("POST", "/api/bots", { name: "shopping" });
    const { task: old } = await api("POST", `/api/bots/${bot.id}/tasks`, {});
    // The inert browser has no saved logins to prepare: a guest profile, set on disk as upstream's own pin tests do.
    await stop();
    const bots = JSON.parse(readFileSync(join(data, "bots.json"), "utf8")) as any[];
    bots.find((saved) => saved.id === bot.id).browserProfile = "guest";
    writeFileSync(join(data, "bots.json"), JSON.stringify(bots, null, 2));
    await start();
    const before = await turn(bot.id, old.threadId);
    expect(before.servers).toEqual(expect.arrayContaining(["lcu", "browser"]));
    expect(before.prompt).toContain("Everything you do on screen happens in the built-in browser tab");
    expect(before.prompt).toContain("another automation path");
    expect(savedTask(bot.id, old.threadId)).toMatchObject({ surface: "browser", surfaceSource: "auto" });
    expect((await turn(bot.id, old.threadId)).prompt).toContain("This conversation is pinned to the built-in browser");
    await stop();

    config({ screenMcpServers: ["lcu"] });
    await start();
    // The conversation an earlier turn pinned: not told it is pinned, and the pin is gone once the turn has run.
    const after = await turn(bot.id, old.threadId);
    expect(after.servers).toEqual(expect.arrayContaining(["lcu", "browser"]));
    for (const gone of ["Everything you do on screen happens", "another automation path", "pinned to"]) expect(after.prompt).not.toContain(gone);
    expect(after.prompt).toContain("to read web pages or use a site they are signed in to, use lcu first.");
    expect(after.prompt).toContain("Use the built-in browser only for a step the person must do by hand in it");
    expect(savedTask(bot.id, old.threadId).surface).toBeUndefined();
    expect(savedTask(bot.id, old.threadId).surfaceSource).toBeUndefined();
    // A new conversation: the same words on its first turn and on its second, and no pin after either.
    const { task: fresh } = await api("POST", `/api/bots/${bot.id}/tasks`, {});
    for (let n = 0; n < 2; n++) {
      const sent = await turn(bot.id, fresh.threadId);
      expect(sent.prompt).toContain("use lcu first.");
      expect(sent.prompt).not.toContain("pinned to");
      expect(savedTask(bot.id, fresh.threadId).surface).toBeUndefined();
    }
    // The person's own pin in the Screen panel stands, with upstream's words.
    await api("PATCH", `/api/bots/${bot.id}/tasks/${fresh.threadId}`, { surface: "browser" });
    const pinned = await turn(bot.id, fresh.threadId);
    expect(pinned.prompt).toContain("This conversation is pinned to the built-in browser");
    expect(pinned.prompt).not.toContain("use lcu first.");
    expect(savedTask(bot.id, fresh.threadId)).toMatchObject({ surface: "browser", surfaceSource: "user" });
    // Codex, which took over his shopping conversation when Claude's limit ran out: the same words reach it.
    const codex = (await api("GET", "/api/instances")).instances.find((item: any) => item.instanceId === "codex");
    await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "codex", model: codex.models.options[0].id } });
    const { task: viaCodex } = await api("POST", `/api/bots/${bot.id}/tasks`, {});
    await api("POST", `/api/bots/${bot.id}/messages`, { text: "看一下京东购物车。", threadId: viaCodex.threadId });
    // Codex has no system prompt file: each turn's context arrives as the first input of turn/start.
    const told = await until((): string => {
      try { return String(JSON.parse(readFileSync(codexDumpFile, "utf8")).calls.find((call: any) => call.method === "turn/start")?.params.input[0].text ?? ""); } catch { return ""; }
    }, Boolean);
    for (const gone of ["Everything you do on screen happens", "another automation path", "pinned to"]) expect(told).not.toContain(gone);
    expect(told).toContain("to read web pages or use a site they are signed in to, use lcu first.");
    expect(told).toContain("Use the built-in browser only for a step the person must do by hand in it");
    await until(() => api("GET", "/api/bots?messages=0").then(({ bots }) => bots.find((saved: any) => saved.id === bot.id)?.tasks.find((task: any) => task.threadId === viaCodex.threadId)), (task) => Boolean(task) && !task.busy);
    expect(savedTask(bot.id, viaCodex.threadId).surface).toBeUndefined();
  }, 180_000);
});
