import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TurnNotStartedError, type RuntimeEvent } from "../contracts.ts";
import { createAcpDriver } from "../drivers/acp/core.ts";
import { classifyRoutineFailure } from "../routine-recovery.ts";
import { endTurn, type AcpTurn } from "../drivers/acp/turn-state.ts";
import {
  antigravityErrorReplyFailure,
  antigravityText,
  isTransientAcpAuthError,
  checkedPromptOutcome,
  retryAuthenticate,
  retryErrorReply,
  shouldRetryAntigravityErrorReply,
} from "./acp-resilience.ts";

const tempDirs: string[] = [];
function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "omb-acp-resilience-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("isTransientAcpAuthError", () => {
  it("reconnects after the delay; a real sign-out is returned immediately", async () => {
    vi.useFakeTimers();
    try {
      const auth = vi.fn().mockRejectedValueOnce(new Error("network is unreachable")).mockResolvedValueOnce("signed in");
      const result = retryAuthenticate("antigravityAgent", () => false, auth);
      await vi.advanceTimersByTimeAsync(1_499);
      expect(auth).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toBe("signed in");
      const denied = vi.fn().mockRejectedValue(new Error("invalid_grant"));
      await expect(retryAuthenticate("antigravityAgent", () => false, denied)).rejects.toThrow("invalid_grant");
      expect(denied).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it("recognizes TLS EOF, urllib3 retries, timeout, and 502 during authenticate as transient", () => {
    expect(isTransientAcpAuthError(new Error(
      "Internal error: HTTPSConnectionPool(host='oauth2.googleapis.com', port=443): Max retries exceeded with url: /token (Caused by SSLError(SSLEOFError(8, 'EOF occurred in violation of protocol (_ssl.c:1105)'))) (authenticate)",
    ))).toBe(true);
    expect(isTransientAcpAuthError(new Error("authenticate timed out"))).toBe(true);
    expect(isTransientAcpAuthError(new Error("HTTP 502 Bad Gateway"))).toBe(true);
    expect(isTransientAcpAuthError(new Error("ECONNRESET"))).toBe(true);
  });

  it("keeps real sign-in failures non-transient", () => {
    expect(isTransientAcpAuthError(new Error("401 Unauthorized"))).toBe(false);
    expect(isTransientAcpAuthError(new Error("403 Forbidden"))).toBe(false);
    expect(isTransientAcpAuthError(new Error("invalid_grant: Token has been expired or revoked."))).toBe(false);
    expect(isTransientAcpAuthError(new Error("Not logged in"))).toBe(false);
  });
});

describe("antigravityErrorReplyFailure", () => {
  it.each(["stop", "tool", "partial"])("does not replay after %s", async (condition) => {
    vi.useFakeTimers();
    try {
      const text = "Agent execution error: HTTP/1.0 502 Bad Gateway";
      const current = { state: { text: condition === "partial" ? "已找到两条记录。\n" + text : text, stopped: false },
        operationSeen: condition === "tool", runningTools: new Set(), asks: new Map() };
      const prompt = vi.fn().mockResolvedValue({ stopReason: "end_turn" });
      const result = retryErrorReply("antigravityAgent", current as unknown as AcpTurn, { closing: false }, undefined, async () => {}, prompt);
      await vi.advanceTimersByTimeAsync(100);
      current.state.stopped = condition === "stop";
      await vi.runAllTimersAsync();
      await result;
      expect(prompt).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it("catches Antigravity's raw 502 Bad Gateway message returned with end_turn", () => {
    const raw =
      "Agent execution error: iterateResponseStream: invalid stream chunk: HTTP/1.0 502 Bad Gateway\r\n" +
      "Server: BaseHTTP/0.6 Python/3.14.8\r\nContent-Type: text/plain; charset=utf-8";
    const failure = antigravityErrorReplyFailure("Google Gemini (Antigravity)", raw);
    expect(failure).not.toBeNull();
    expect(classifyRoutineFailure(failure!.message, { stopReason: failure!.stopReason })).toEqual({ kind: "final" });
    expect(failure!.message).toContain("502");
    expect(shouldRetryAntigravityErrorReply(raw)).toBe(true);
  });

  it("uses a matching raw 502 when the native log confirms a temporary error, but honours an explicit refusal", async () => {
    const current = { state: { text: "已找到两条。\nAgent execution error: HTTP/1.0 502 Bad Gateway" } } as AcpTurn;
    const check = (error: Error) => checkedPromptOutcome("antigravityAgent", current, { stopReason: "end_turn" }, async () => error);
    await expect(check(Object.assign(new Error("HTTP 502"), { checkErrorReply: true }))).resolves.toBeUndefined();
    const quota = new Error("quota");
    await expect(check(quota)).resolves.toBe(quota);
    expect(current.state.text.trim()).toBe("已找到两条。");
  });

  it("keeps the log's runtime restart when the retry has failed too, in the reply's friendly words", async () => {
    const current = { state: { text: "已找到两条。\nAgent execution error: HTTP/1.0 502 Bad Gateway" } } as AcpTurn;
    const native = Object.assign(new Error("HTTP 502"), { checkErrorReply: true, acpSessionFailure: true });
    const failure = await checkedPromptOutcome("antigravityAgent", current, { stopReason: "end_turn" }, async () => native, "Google Gemini (Antigravity)");
    expect(failure).toMatchObject({ message: "Google Gemini (Antigravity) 暂时连不上服务（HTTP 502），请稍后再试。", acpSessionFailure: true, antigravityUnavailable: true });
    expect(current.state.text.trim()).toBe("已找到两条。");
  });

  it("does not take a reply that explains a 502, or quotes one mid-sentence, for the engine's error", () => {
    const explained = "Agent execution error: HTTP/1.0 502 Bad Gateway\n这通常是临时网络故障，过一会儿再试就好。";
    expect(shouldRetryAntigravityErrorReply(explained)).toBe(false);
    expect(antigravityErrorReplyFailure("Google Gemini (Antigravity)", explained)).toBeNull();
    expect(antigravityErrorReplyFailure("Google Gemini (Antigravity)", "这条日志的完整原文是 Agent execution error: HTTP/1.0 502 Bad Gateway")).toBeNull();
  });

  it("does not call a certificate the machine does not trust a passing blip", () => {
    expect(isTransientAcpAuthError(new Error("Max retries exceeded with url: /token (Caused by SSLError(SSLCertVerificationError(1, '[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate')))"))).toBe(false);
  });

  it("cuts Gemini's thinking from Antigravity's stored replies only", () => {
    const leaked = "💡 Thought\n Let's check the tabs first and then tell the user what we found in one sentence.看到你 Chrome 里开着公众号后台。";
    expect(antigravityText("antigravityAgent", leaked)).toBe("看到你 Chrome 里开着公众号后台。");
    const quoted = "The file cannot be opened because it is in use.\n这个文件正被占用。";
    expect(antigravityText("claudeAgent", quoted)).toBe(quoted);
    expect(antigravityText("codex", leaked)).toBe(leaked);
  });

  it("ignores normal replies that merely discuss 502 errors", () => {
    expect(antigravityErrorReplyFailure("Google Gemini (Antigravity)", "刚才遇到了一次 502 Bad Gateway，已经重试成功。")).toBeNull();
    expect(antigravityErrorReplyFailure("Google Gemini (Antigravity)", "Agent execution error is a phrase in the log.")).toBeNull();
    expect(antigravityErrorReplyFailure("Google Gemini (Antigravity)", "日志里出现 `Agent execution error: iterateResponseStream: HTTP/1.0 502 Bad Gateway`")).toBeNull();
    expect(antigravityErrorReplyFailure("Google Gemini (Antigravity)", "昨天撞上 Agent execution error: HTTP/1.0 502 Bad Gateway，现在好了。")).toBeNull();
  });

  it("preserves partial assistant text and fails the turn when 502 is appended mid-stream before end_turn", () => {
    let flushedText = "";
    const turn = {
      turnId: "t2",
      turn: { threadId: "th1", text: "hi" },
      turnConfig: { cli: "fake", fullAuto: true },
      controlsHost: false,
      state: {
        settled: false,
        promptSent: true,
        text: "先查到两条优惠：\nAgent execution error: iterateResponseStream: invalid stream chunk: HTTP/1.0 502 Bad Gateway",
        textMessageId: null,
        producedItem: false,
        repliedText: false,
        startupActivity: true,
        stopped: false,
        usagePeak: null,
        usageLast: null,
        usageCompacted: false,
        cancelling: false,
      },
      acknowledge: () => {},
      asks: new Map(),
      runningTools: new Set(),
      unkeyedToolIds: [],
      endedToolIds: new Set(),
      interruptTimer: null,
      stopQuietWatch: null,
      flushAssistantText: () => { flushedText = turn.state.text; turn.state.text = ""; },
      receiveModelVariants: () => {},
    } as unknown as AcpTurn;

    expect(shouldRetryAntigravityErrorReply(turn.state.text)).toBe(false);
    const end = endTurn(turn, true, null, "Google Gemini (Antigravity)", "antigravityAgent");
    expect(end.ok).toBe(false);
    expect(end.stopReason).toBe("antigravity_unavailable");
    expect(end.error?.message).toContain("502");
    expect(flushedText.trim()).toBe("先查到两条优惠：");
  });

  it("makes endTurn fail cleanly even after earlier tool calls or progress text", () => {
    let flushed = false;
    const turn = {
      turnId: "t1",
      turn: { threadId: "th1", text: "hi" },
      turnConfig: { cli: "fake", fullAuto: true },
      controlsHost: false,
      state: {
        settled: false,
        promptSent: true,
        text: "Agent execution error: iterateResponseStream: HTTP/1.0 502 Bad Gateway",
        textMessageId: null,
        producedItem: true,
        repliedText: true,
        startupActivity: true,
        stopped: false,
        usagePeak: null,
        usageLast: null,
        usageCompacted: false,
        cancelling: false,
      },
      acknowledge: () => {},
      asks: new Map(),
      runningTools: new Set(),
      unkeyedToolIds: [],
      endedToolIds: new Set(),
      interruptTimer: null,
      stopQuietWatch: null,
      flushAssistantText: () => { flushed = true; },
      receiveModelVariants: () => {},
    } as unknown as AcpTurn;

    const end = endTurn(turn, true, null, "Google Gemini (Antigravity)", "antigravityAgent");
    expect(end.ok).toBe(false);
    expect(end.stopReason).toBe("antigravity_unavailable");
    expect(end.error?.message).toContain("502");
    expect(flushed).toBe(false);
  });
});

describe("ACP driver integration for transient authenticate and 502 end_turn", () => {
  function writeFakeAcp(dir: string, script: string): string {
    const file = join(dir, "fake-acp.mjs");
    writeFileSync(file, script, "utf8");
    return file;
  }

  it("surfaces transient authenticate SSLEOFError to startupRecovery instead of misreporting sign-out", async () => {
    const dir = makeTmp();
    const fake = writeFakeAcp(dir, `
      import readline from "node:readline";
      const rl = readline.createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        const msg = JSON.parse(line);
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0", id: msg.id,
            result: { protocolVersion: 1, authMethods: [{ id: "oauth-personal" }], agentCapabilities: {} },
          }) + "\\n");
        } else if (msg.method === "authenticate") {
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0", id: msg.id,
            error: {
              code: -32603,
              message: "Internal error",
              data: { details: "HTTPSConnectionPool(host='oauth2.googleapis.com', port=443): Max retries exceeded with url: /token (Caused by SSLError(SSLEOFError(8, 'EOF occurred in violation of protocol')))" },
            },
          }) + "\\n");
        }
      });
    `);
    const driver = createAcpDriver({
      driverKind: "antigravityAgent",
      displayName: "Test Antigravity",
      models: { default: "m", options: [{ id: "m", label: "M" }] },
      defaultCli: process.execPath,
      nativeSource: "test.acp",
      loginNote: "Please sign in again",
      spawnArgs: () => [fake],
      pickAuthMethod: () => "oauth-personal",
      authFailure: "fail",
      isAuthenticated: () => true,
    });
    const inst = await driver.create({ instanceId: "test-auth", displayName: "Test", enabled: true, config: { cli: process.execPath, fullAuto: true }, environment: {} });
    try {
      await expect(inst.adapter.sendTurn({
        threadId: "th-auth",
        text: "hello",
        cwd: dir,
        startupRecovery: true,
      })).rejects.toBeInstanceOf(TurnNotStartedError);
    } finally {
      await inst.dispose();
    }
  });

  it.each([true, false])("tries a 502 once more and completes once (recovers: %s)", async (recovers) => {
    const dir = makeTmp();
    const stateFile = join(dir, "attempts.txt");
    const fake = writeFakeAcp(dir, `
      import fs from "node:fs";
      import readline from "node:readline";
      const stateFile = ${JSON.stringify(stateFile)};
      const rl = readline.createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        const msg = JSON.parse(line);
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0", id: msg.id,
            result: { protocolVersion: 1, authMethods: [], agentCapabilities: { sessionCapabilities: { additionalDirectories: {} } } },
          }) + "\\n");
        } else if (msg.method === "session/new") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "s-1" } }) + "\\n");
        } else if (msg.method === "session/prompt") {
          const n = (fs.existsSync(stateFile) ? Number(fs.readFileSync(stateFile, "utf8")) : 0) + 1;
          fs.writeFileSync(stateFile, String(n));
          const text = n === 1 || !${recovers}
            ? "Agent execution error: iterateResponseStream: invalid stream chunk: HTTP/1.0 502 Bad Gateway"
            : "🫧thought\\nLet's check the model and get the result.已经恢复。";
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0", method: "session/update",
            params: { sessionId: "s-1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } },
          }) + "\\n");
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } }) + "\\n");
        }
      });
    `);
    const prev = process.env.OMB_ACP_ERROR_REPLY_RETRY_MS;
    process.env.OMB_ACP_ERROR_REPLY_RETRY_MS = "0";
    const driver = createAcpDriver({
      driverKind: "antigravityAgent",
      displayName: "Test Antigravity",
      models: { default: "m", options: [{ id: "m", label: "M" }] },
      defaultCli: process.execPath,
      nativeSource: "test.acp",
      loginNote: "Please sign in again",
      spawnArgs: () => [fake],
      pickAuthMethod: () => null,
      authFailure: "continue",
      isAuthenticated: () => true,
    });
    const inst = await driver.create({ instanceId: "test-502", displayName: "Test", enabled: true, config: { cli: process.execPath, fullAuto: true }, environment: {} });
    const events: RuntimeEvent[] = [];
    const done = new Promise<RuntimeEvent>((resolve) => {
      inst.adapter.onEvent((event) => {
        events.push(event);
        if (event.type === "turn.completed") resolve(event);
      });
    });
    try {
      await inst.adapter.sendTurn({ threadId: "th-502", text: "hello", model: "gemini-4-argon", cwd: dir });
      const completed = await done;
      expect(completed.type === "turn.completed" && completed.ok).toBe(recovers);
      expect(readFileSync(stateFile, "utf8")).toBe("2");
      expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
      const errors = events.filter((event) => event.type === "runtime.error").map((event) => event.message);
      expect(errors).toEqual(recovers ? [] : ["Test Antigravity 暂时连不上服务（HTTP 502），请稍后再试。"]);
      expect(events.filter((event) => event.type === "content.delta")).toEqual([]);
      const texts = events.filter((e) => e.type === "item.completed" && e.itemType === "assistant_text").map((e: any) => e.text);
      expect(texts).toEqual(recovers ? ["已经恢复。"] : []);
    } finally {
      if (prev === undefined) delete process.env.OMB_ACP_ERROR_REPLY_RETRY_MS;
      else process.env.OMB_ACP_ERROR_REPLY_RETRY_MS = prev;
      await inst.dispose();
    }
  });
});
