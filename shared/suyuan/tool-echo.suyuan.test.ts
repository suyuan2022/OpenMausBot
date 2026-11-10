// suyuan fork: the copy of a tool call that Gemini 4 writes into its reply under Antigravity is cut out of the text,
// whole or still streaming in, and nothing else is.
import { describe, expect, it } from "vitest";
import { stripLeakedSystemHarnessMessages } from "../system-message-guard.ts";
import { stripToolEcho } from "./tool-echo.ts";

const SAID = "用不同思考程度来横评写 X 帖子这个路子很意思，我先去翻翻你昨天在 Antigravity 里写那篇帖子的对话记录 🔍";
// As a bot on gemini-4-argon wrote it on 2026-11-10, with the command shortened.
const ECHO = '工具调用_start:[{"name": "run_command", "args": {"CommandLine": "ls -lt ~/.gemini/antigravity/brain/ 2>/dev/null | head -n 40", "Cwd": "/Users/lizhi/Documents/suyuanos/02 副业", "toolAction": "Searching logs", "toolSummary": "Search Antigravity conversation logs"}}]工具调用_end';

describe("stripToolEcho", () => {
  it("cuts a whole copy off the end of a reply", () => {
    expect(stripToolEcho(SAID + ECHO)).toBe(SAID);
  });

  it("cuts every copy in a reply and keeps what stands between them", () => {
    expect(stripToolEcho(`先看日志。${ECHO}看完了，再跑一次。${ECHO}`)).toBe("先看日志。看完了，再跑一次。");
  });

  it("cuts a copy that lists two calls, or none", () => {
    const two = '工具调用_start:[{"name": "view_file", "args": {"AbsolutePath": "/a.md"}}, {"name": "view_file", "args": {"AbsolutePath": "/b[1].md"}}]工具调用_end';
    expect(stripToolEcho(`连去 MacBook 上找。${two}`)).toBe("连去 MacBook 上找。");
    expect(stripToolEcho("等它返回结果。工具调用_start:[]工具调用_end")).toBe("等它返回结果。");
  });

  it("shows no part of a copy while the reply streams in, a character at a time", () => {
    const whole = SAID + ECHO;
    for (let end = 0; end <= whole.length; end += 1) {
      const shown = stripToolEcho(whole.slice(0, end));
      // Up to the mark's first four characters, which are a word of their own ("tool call"), may show for a moment.
      expect(`${SAID}工具调用`.startsWith(shown), `after ${end} characters: ${shown.slice(-30)}`).toBe(true);
    }
    expect(stripToolEcho(whole)).toBe(SAID);
  });

  it("cuts a copy that never got its end mark, as when the turn was stopped", () => {
    expect(stripToolEcho(`${SAID}工具调用_start:[{"name": "run_command", "args": {"CommandLine": "sleep 60`)).toBe(SAID);
  });

  it("keeps a sentence that only names the mark, and text with no mark", () => {
    const named = "它在每条回复后面都写了一段「工具调用_start:[…]工具调用_end」，中间是这次调用的 JSON。";
    expect(stripToolEcho(named)).toBe(named);
    const about = "这一轮要用工具时先说一句，工具调用之间不用再插话。";
    expect(stripToolEcho(about)).toBe(about);
    const plain = "两个定时都挂好了 👌";
    expect(stripToolEcho(plain)).toBe(plain);
  });
});

describe("stripLeakedSystemHarnessMessages", () => {
  it("cuts the copy too: the server stores replies and the chat draws them through this guard", () => {
    expect(stripLeakedSystemHarnessMessages(`${SAID}${ECHO}`)).toBe(SAID);
    expect(stripLeakedSystemHarnessMessages(`<SYSTEM_MESSAGE>task done</SYSTEM_MESSAGE>${SAID}${ECHO}`)).toBe(SAID);
  });
});
