// POSIX-gated: the fake CLI is a shebang script. Real server, fake Claude that runs the --settings hooks and plays a
// compaction at the start of every turn after its first, echoing what SessionStart's hooks printed into its reply.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { workerPort } from "../testing/worker-port.ts";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const ABOUT_ME = "夙愿：回复写短，结论放最前面。";

type Msg = { role: string; kind: string; text?: string; tool?: { name: string } };

describe.skipIf(process.platform === "win32")("after a compaction mid-turn, Claude gets the turn's volatile half again", () => {
  const PORT = workerPort(18800, 10_000);
  const BASE = `http://127.0.0.1:${PORT}`;
  let child: ChildProcess;
  let home = "";
  let stderr = "";
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  const getBot = async (id: string) => (await api("GET", "/api/bots")).body.bots.find((b: { id: string }) => b.id === id);
  const turn = async (botId: string, text: string, replies: number) => {
    expect((await api("POST", `/api/bots/${botId}/messages`, { text })).status).toBe(202);
    const deadline = Date.now() + 30_000;
    for (;;) {
      const bot = await getBot(botId);
      const texts = (bot?.messages ?? []).filter((m: Msg) => m.role === "bot" && m.kind === "text" && m.text);
      if (bot && !bot.busy && texts.length >= replies) return { reply: texts.at(-1).text as string, messages: bot.messages as Msg[] };
      if (Date.now() > deadline) throw new Error(`timed out waiting for a reply. stderr: ${stderr.slice(-3000)}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  };
  const newBot = async (patch: Record<string, unknown> = {}) => {
    const bot = (await api("POST", "/api/bots")).body.bot;
    expect((await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "claude", model: "fake-model" }, ...patch })).status).toBe(200);
    return bot.id as string;
  };

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    home = mkdtempSync(join(tmpdir(), "omb-compact-volatile-e2e-"));
    mkdirSync(join(home, ".openmausbot"), { recursive: true });
    writeFileSync(join(home, ".openmausbot", "config.json"), JSON.stringify({
      profile: { aboutMe: ABOUT_ME },
      instances: { claude: { driver: "claudeAgent", config: { cli: FAKE_CLAUDE }, environment: {
        FAKE_CLAUDE_TURN_STATE: join(home, "turns"), FAKE_CLAUDE_HOOKS: "1", FAKE_CLAUDE_COMPACT: "1", FAKE_CLAUDE_TOOL_CALLS: "[]",
      } } },
    }));
    const env: NodeJS.ProcessEnv = { HOME: home, USERPROFILE: home, OMB_PORT: String(PORT) };
    if (process.env.PATH) env.PATH = process.env.PATH;
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], { cwd: join(SERVER_DIR, ".."), env, stdio: ["ignore", "pipe", "pipe"] });
    child.stderr!.on("data", (c) => (stderr += c));
    const deadline = Date.now() + 20_000;
    for (;;) {
      try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {}
      if (Date.now() > deadline || child.exitCode !== null) throw new Error(`server never came up. stderr:\n${stderr}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }, 30_000);
  afterAll(async () => {
    await waitForExit(child, { signal: "SIGTERM" });
    await removeTempDir(home);
  });

  it("re-sends the person's profile and, on the person's turn of a Just do it bot, Just do it; upstream's digests still go too", async () => {
    const full = await newBot();
    await turn(full, "first", 1);
    const { reply, messages } = await turn(full, "second, after the compaction", 2);
    expect(reply).toContain("The conversation was just compacted");
    expect(reply).toContain(ABOUT_ME);
    expect(reply).toContain("Just do it is on");
    expect(reply).toContain("did in an earlier turn");
    expect(messages.filter((m) => m.kind === "activity" && m.tool?.name.startsWith("context compact")).map((m) => m.tool!.name))
      .toEqual(["context compaction started (auto)", "context compacted — re-sent the last 1 digest"]);

    // Another conversation's turn, on a bot at Ask: its own half, never the first bot's Just do it.
    const ask = await newBot({ approvalMode: "ask" });
    const other = await turn(ask, "a turn in another conversation", 1);
    expect(other.reply).toContain("The conversation was just compacted");
    expect(other.reply).toContain(ABOUT_ME);
    expect(other.reply).not.toContain("Just do it");
  }, 90_000);
});
