import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { RuntimeEvent } from "../contracts.ts";
import { createAcpDriver } from "../drivers/acp/core.ts";
import { workspaceDir } from "../workspace.ts";
import {
  acpAdditionalDirectories,
  effectiveSessionKey,
  resolveClientPathInRoots,
  supportsAdditionalDirectories,
} from "./acp-extra-dirs.ts";

const tempDirs: string[] = [];
function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "omb-acp-extra-dirs-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("acpAdditionalDirectories", () => {
  it("detects advertised sessionCapabilities.additionalDirectories", () => {
    expect(supportsAdditionalDirectories(null)).toBe(false);
    expect(supportsAdditionalDirectories({ agentCapabilities: {} })).toBe(false);
    expect(supportsAdditionalDirectories({ agentCapabilities: { sessionCapabilities: { resume: {} } } })).toBe(false);
    expect(supportsAdditionalDirectories({ agentCapabilities: { sessionCapabilities: { additionalDirectories: {} } } })).toBe(true);
    expect(supportsAdditionalDirectories({ agentCapabilities: { sessionCapabilities: { additionalDirectories: true } } })).toBe(true);
  });

  it("returns bot workspace, task-workspace, and existing shared skills dirs when advertised", () => {
    const root = makeTmp();
    const cwd = join(root, "suyuanos");
    const dataDir = join(root, "omb");
    const homeDir = join(root, "home");
    const botId = "bot-123";
    const botWs = join(dataDir, "workspaces", botId);
    const taskWs = join(dataDir, "task-workspaces", botId);
    const agentSkills = join(homeDir, ".agents", "skills");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(join(botWs, "memory"), { recursive: true });
    mkdirSync(taskWs, { recursive: true });
    mkdirSync(agentSkills, { recursive: true });

    const init = { agentCapabilities: { sessionCapabilities: { additionalDirectories: {} } } };
    const dirs = acpAdditionalDirectories({ botId, cwd, initResult: init, dataDir, homeDir });
    expect(dirs).toEqual([botWs, taskWs, agentSkills]);

    // Without capability advertisement, returns empty so other ACP agents stay untouched.
    expect(acpAdditionalDirectories({ botId, cwd, initResult: { agentCapabilities: {} }, dataDir, homeDir })).toEqual([]);
  });

  it("skips dirs inside cwd and missing dirs", () => {
    const root = makeTmp();
    const cwd = join(root, "home");
    const dataDir = join(root, "omb");
    const botId = "bot-a";
    const botWs = join(dataDir, "workspaces", botId);
    const agentSkills = join(cwd, ".agents", "skills");
    mkdirSync(botWs, { recursive: true });
    mkdirSync(agentSkills, { recursive: true });

    const init = { agentCapabilities: { sessionCapabilities: { additionalDirectories: {} } } };
    expect(acpAdditionalDirectories({ botId, cwd, initResult: init, dataDir, homeDir: cwd })).toEqual([botWs]);
  });

  it("keeps base sessionKey unchanged when no additional directories are active", () => {
    expect(effectiveSessionKey("base", [])).toBe("base");
    expect(effectiveSessionKey("base", ["/a"])).not.toBe("base");
  });
});

describe("resolveClientPathInRoots", () => {
  it("allows files inside cwd, bot memory, and symlinked shared skills, while blocking outside paths and file symlinks", async () => {
    const root = makeTmp();
    const cwd = join(root, "project");
    const botWs = join(root, "workspaces", "bot-1");
    const sharedSkills = join(root, "home", ".agents", "skills");
    const otherBotWs = join(root, "workspaces", "bot-2");
    mkdirSync(join(cwd, ".claude", "skills"), { recursive: true });
    mkdirSync(join(botWs, "memory"), { recursive: true });
    mkdirSync(join(sharedSkills, "web-tools"), { recursive: true });
    mkdirSync(otherBotWs, { recursive: true });

    const memFile = join(botWs, "memory", "ns线报.md");
    const skillFile = join(sharedSkills, "web-tools", "SKILL.md");
    const otherFile = join(otherBotWs, "MEMORY.md");
    writeFileSync(memFile, "# NS\n");
    writeFileSync(skillFile, "# Web Tools\n");
    writeFileSync(otherFile, "# Secret\n");
    symlinkSync(join(sharedSkills, "web-tools"), join(cwd, ".claude", "skills", "web-tools"));
    symlinkSync(otherFile, join(cwd, "escape.md"));

    const roots = [cwd, botWs, sharedSkills];
    expect(await resolveClientPathInRoots(roots, memFile)).toBe(realpathSync(memFile));
    expect(await resolveClientPathInRoots(roots, join(botWs, "memory", "new-topic.md"))).toBe(
      join(realpathSync(join(botWs, "memory")), "new-topic.md"),
    );
    // Symlinked skill directory inside cwd resolves into allowed sharedSkills root.
    expect(await resolveClientPathInRoots(roots, join(cwd, ".claude", "skills", "web-tools", "SKILL.md"))).toBe(
      realpathSync(skillFile),
    );
    // Direct path to another bot's workspace is blocked.
    await expect(resolveClientPathInRoots(roots, otherFile)).rejects.toThrow("outside the session workspace");
    // Direct file symlink inside cwd pointing outside is blocked.
    await expect(resolveClientPathInRoots(roots, join(cwd, "escape.md"))).rejects.toThrow("cannot be a symbolic link");
    // Relative path is blocked.
    await expect(resolveClientPathInRoots(roots, "relative.md")).rejects.toThrow("must be absolute");
  });
});

describe("ACP driver integration for additionalDirectories and clientFileSystem", () => {
  it("passes additionalDirectories in session/new and session/resume and serves fs/read_text_file from bot memory", async () => {
    const root = makeTmp();
    const cwd = join(root, "project");
    const botId = `test-bot-${Date.now()}`;
    const botWs = workspaceDir(botId);
    const otherBotId = `test-other-${Date.now()}`;
    const otherWs = workspaceDir(otherBotId);
    tempDirs.push(botWs, otherWs);
    mkdirSync(cwd, { recursive: true });
    mkdirSync(join(botWs, "memory"), { recursive: true });
    mkdirSync(join(otherWs, "memory"), { recursive: true });
    const ownNote = join(botWs, "memory", "ns线报.md");
    const otherNote = join(otherWs, "memory", "secret.md");
    writeFileSync(ownNote, "Switch 2 羊毛笔记");
    writeFileSync(otherNote, "别人的秘密");

    const logFile = join(root, "rpc-log.jsonl");
    const fake = join(root, "fake-acp.mjs");
    writeFileSync(fake, `
      import fs from "node:fs";
      import readline from "node:readline";
      const logFile = ${JSON.stringify(logFile)};
      const ownNote = ${JSON.stringify(ownNote)};
      const otherNote = ${JSON.stringify(otherNote)};
      const rl = readline.createInterface({ input: process.stdin });
      let pendingPromptId = null;
      let ownResult = null;
      let otherResult = null;
      rl.on("line", (line) => {
        const msg = JSON.parse(line);
        fs.appendFileSync(logFile, JSON.stringify(msg) + "\\n");
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0", id: msg.id,
            result: { protocolVersion: 1, authMethods: [], agentCapabilities: { sessionCapabilities: { additionalDirectories: {}, resume: {} } } },
          }) + "\\n");
        } else if (msg.method === "session/new") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "sess-1" } }) + "\\n");
        } else if (msg.method === "session/resume") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: msg.params.sessionId } }) + "\\n");
        } else if (msg.method === "session/prompt") {
          pendingPromptId = msg.id;
          ownResult = null;
          otherResult = null;
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 901, method: "fs/read_text_file", params: { path: ownNote } }) + "\\n");
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 902, method: "fs/read_text_file", params: { path: otherNote } }) + "\\n");
        } else if (msg.id === 901 || msg.id === 902) {
          if (msg.id === 901) ownResult = msg;
          if (msg.id === 902) otherResult = msg;
          if (ownResult && otherResult && pendingPromptId !== null) {
            const reply = JSON.stringify({ own: ownResult.result?.content ?? null, otherErr: otherResult.error?.message ?? null });
            process.stdout.write(JSON.stringify({
              jsonrpc: "2.0", method: "session/update",
              params: { sessionId: "sess-1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: reply } } },
            }) + "\\n");
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: pendingPromptId, result: { stopReason: "end_turn" } }) + "\\n");
            pendingPromptId = null;
          }
        }
      });
    `);

    const driver = createAcpDriver({
      driverKind: "testAcp",
      displayName: "Test Antigravity",
      models: { default: "m", options: [{ id: "m", label: "M" }] },
      defaultCli: process.execPath,
      nativeSource: "test.acp",
      loginNote: "Sign in",
      spawnArgs: () => [fake],
      pickAuthMethod: () => null,
      authFailure: "continue",
      isAuthenticated: () => true,
      resumeMethod: "resume",
      clientFileSystem: true,
    });
    const inst = await driver.create({ instanceId: "test-extra", displayName: "Test", enabled: true, config: { cli: process.execPath, fullAuto: true }, environment: {} });
    const runTurn = (opts: { resumeCursor?: string; sessionReset?: boolean }) => new Promise<string>((resolve) => {
      const texts: string[] = [];
      const off = inst.adapter.onEvent((event: RuntimeEvent) => {
        if (event.type === "item.completed" && event.itemType === "assistant_text") texts.push(event.text);
        if (event.type === "turn.completed") {
          off();
          resolve(texts.join(""));
        }
      });
      void inst.adapter.sendTurn({ threadId: "th-extra", botId, text: "read note", cwd, ...opts });
    });
    try {
      const first = JSON.parse(await runTurn({}));
      expect(first.own).toBe("Switch 2 羊毛笔记");
      expect(first.otherErr).toContain("outside the session workspace");

      // Resume in a fresh process (sessionReset: false, after stopAll closes the pooled process)
      await inst.adapter.stopAll();
      const second = JSON.parse(await runTurn({ resumeCursor: "sess-1" }));
      expect(second.own).toBe("Switch 2 羊毛笔记");

      const calls = (await import("node:fs")).readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
      const newCall = calls.find((m) => m.method === "session/new");
      const resumeCall = calls.find((m) => m.method === "session/resume");
      expect(newCall.params.additionalDirectories).toContain(botWs);
      expect(resumeCall.params.additionalDirectories).toContain(botWs);
    } finally {
      await inst.dispose();
    }
  });
});
