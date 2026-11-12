// suyuan fork: the copy of a tool call that Gemini 4 writes into its reply under Antigravity is cut out of the text,
// and text that only talks about the mark is left whole.
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

  it("cuts a copy whose command runs over several lines, one that lists two calls, and one that lists none", () => {
    const lines = '工具调用_start:[{"name": "run_command", "args": {"CommandLine": "python3 -c \'\nimport json\nrows = [1, 2]\nprint(json.dumps(rows))\n\'"}}]工具调用_end';
    expect(stripToolEcho(`我把前 41 步读过的文件提出来。${lines}`)).toBe("我把前 41 步读过的文件提出来。");
    const two = '工具调用_start:[{"name": "view_file", "args": {"AbsolutePath": "/a.md"}}, {"name": "view_file", "args": {"AbsolutePath": "/b[1].md"}}]工具调用_end';
    expect(stripToolEcho(`连去 MacBook 上找。${two}`)).toBe("连去 MacBook 上找。");
    expect(stripToolEcho("等它返回结果。工具调用_start:[]工具调用_end")).toBe("等它返回结果。");
  });

  it("keeps a reply that explains the mark, with everything after it", () => {
    const explained = "开头是 `工具调用_start:[{` ，结尾是 `}]` 再加 `工具调用_end`。\n\n## 怎么修\n\n在公共的过滤函数里把这段去掉。";
    expect(stripToolEcho(explained)).toBe(explained);
    const listed = "每条回复后面会跟一段 `工具调用_start:[{…}]工具调用_end`（这次调用的 JSON）。";
    expect(stripToolEcho(listed)).toBe(listed);
  });

  it("keeps a code block that holds a copy with no end mark, and the words after the block", () => {
    const report = "测试里有这一行：\n```ts\nexpect(stripToolEcho(`${SAID}工具调用_start:[{\"name\": \"run_command\", \"args\": {\"CommandLine\": \"sleep 60`)).toBe(SAID);\n```\n验证：全绿。";
    expect(stripToolEcho(report)).toBe(report);
  });

  it("keeps text that has the words but not the mark", () => {
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
