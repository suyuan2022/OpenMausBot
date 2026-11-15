// suyuan fork: Gemini's thinking that Antigravity hands over as reply text is cut out, and only the reply is kept.
// The fixtures are replies a bot on gemini-4-argon wrote on 2026-11-10 and 2026-11-15, as stored then.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPureLeakedSystemHarnessMessage, stripLeakedSystemHarnessMessages } from "../system-message-guard.ts";
import { stripThoughtLeak } from "./thought-leak.ts";

const REACTION = "要是能把公众号后台的单篇转化、投流加热和流量主数据也像 X 那样一键拉下来，以后复盘就省事太多了 👀 我先看一眼 `x-analytics` 的结构和控制你电脑 Chrome 的方式，再去探探公众号后台能抓哪些数据。";
// The thinking quotes a first draft of the reply in Chinese, then the reply follows its last full stop.
const DRAFTED = "💡 Thought\n Let's first send a quick reaction line to the user (\"要是能把公众号后台的单篇转化、投流加热和读者画像也像 X 那样一键拉下来，以后复盘就太爽了 👀 我先看看 `x-analytics` 是怎么写的，再连去你电脑 Chrome 上的公众号后台探探能抓哪些接口和页面。\"), and call `run_command` to read `lcu/SKILL.md` and `x-analytics/SKILL.md`." + REACTION;
const FOUND = "看到你 MacBook 的 Chrome 里正开着公众号后台和加热订单详情页（`heat_promotion_id=1794585600_2181808`），我先用只读方式探一下这个加热页和后台统计模块的接口结构，不抢你鼠标。";
const LISTED = "💡 Thought\n Look at the MacBook Chrome tabs!\nThere are two open tabs for 公众号:\n1. `id: \"9203423\"`, `url: \"https://mp.weixin.qq.com/cgi-bin/mppromotionorder?token=«redacted 8 chars»&action=dashboard\"`\n\nLet's tell the user in one short sentence what we found (as per his rule: \"途中只说跟他这件事有关的发现：找到原因了、方向换了、有他得知道的风险。说的时候把发现本身说出来。\").\nAnd let's read those two tabs (using `tab.evaluate`, which doesn't even steal mouse/keyboard focus!)." + FOUND;
const BOTH = "सिस्टम/thought: Both files are safely saved on disk! I'll confirm concisely in one short message and stop.整篇 462 行的完整初稿 [2026-11-10-Claude防封号新版（Fable5.2版）.md](file:///Users/lizhi/Documents/suyuanos/02%20副业/01%20X/2026-11-10-Claude防封号新版（Fable5.2版）.md) 和要点清单 [Claude防封号新版-视频与盲区要点整理.md](file:///Users/lizhi/Documents/suyuanos/02%20副业/01%20X/Claude防封号新版-视频与盲区要点整理.md) 都已经存好了，待插图和待填的 `clash-guard` Prompt 空位也都标在里面，等你晚上回来随时接着改 👌";
const EVRIER = "évrierसिस्टम/thought: I just read blindspot #14. Now let's invoke a `research` subagent (which uses `Model: \"inherit\"`, i.e., Gemini 4) to do a thorough audit o …\n\nLet's tell the user we're launching the Gemini 4 subagent to audit the draft against all materials and requirements, and invoke `invoke_subagent`.查到你在盲区库第 14 条和第 5 条里的原话了，我现在拉起一个独立的 Gemini 4 子智能体，对照旧长文、视频提词稿、55 条盲区和你刚才交代的所有要求，把整篇初稿逐段审查一遍。";

describe("stripThoughtLeak", () => {
  it("keeps only the reply glued onto the end of the thinking", () => {
    expect(stripThoughtLeak(DRAFTED)).toBe(REACTION);
    expect(stripThoughtLeak(LISTED)).toBe(FOUND);
  });

  it("leaves nothing of a reply that is only thinking", () => {
    expect(stripThoughtLeak("💡 Thought\n Forgot `FULL=1`! Without `FULL=1`, `mcpc.mjs` slices lines at 6000 chars. Let's run with `FULL=1`.")).toBe("");
    expect(stripThoughtLeak("Thought\nWhy did `t1 is not defined` happen? Let's print every line.")).toBe("");
    expect(stripThoughtLeak("सिस्टम/thought: Let's read the first half of that output (item 14 in `防封盲区清单.md`)!")).toBe("");
  });

  it("cuts the earlier marks too", () => {
    expect(stripThoughtLeak(BOTH)).toBe("整篇 462 行的完整初稿 [2026-11-10-Claude防封号新版（Fable5.2版）.md](file:///Users/lizhi/Documents/suyuanos/02%20副业/01%20X/2026-11-10-Claude防封号新版（Fable5.2版）.md) 和要点清单 [Claude防封号新版-视频与盲区要点整理.md](file:///Users/lizhi/Documents/suyuanos/02%20副业/01%20X/Claude防封号新版-视频与盲区要点整理.md) 都已经存好了，待插图和待填的 `clash-guard` Prompt 空位也都标在里面，等你晚上回来随时接着改 👌");
    expect(stripThoughtLeak(EVRIER)).toBe("查到你在盲区库第 14 条和第 5 条里的原话了，我现在拉起一个独立的 Gemini 4 子智能体，对照旧长文、视频提词稿、55 条盲区和你刚才交代的所有要求，把整篇初稿逐段审查一遍。");
    expect(stripThoughtLeak("[-thought-]拿你素材池的四项尺子（带走、疼、换名、有数）和今天的时间窗一对照：\n\n| 选题 | 热度 |\n|---|---|\n| **借 Fable 5.2 讲 Agent 省 Token** | 极高 |"))
      .toBe("拿你素材池的四项尺子（带走、疼、换名、有数）和今天的时间窗一对照：\n\n| 选题 | 热度 |\n|---|---|\n| **借 Fable 5.2 讲 Agent 省 Token** | 极高 |");
    expect(stripThoughtLeak("正在查 `clash-guard.md` 的创建时间。`clash-guard.md` 是 11 月 6 日凌晨 00:01 生成的。]</thought>正在等 11 月 6 日那条 `clash-guard` 实测日志搜出来。"))
      .toBe("正在等 11 月 6 日那条 `clash-guard` 实测日志搜出来。");
    expect(stripThoughtLeak("<thought>Check the log first.</thought>日志里没有报错。")).toBe("日志里没有报错。");
  });

  it("keeps replies that only talk about the marks, and replies with no mark", () => {
    const about = "思考漏进正文，形如开头的 `[-thought-]`、`सिस्टम/thought: …`、`…</thought>`，还有一行 `💡 Thought`。";
    expect(stripThoughtLeak(about)).toBe(about);
    const fenced = "过滤规则：\n```\n💡 Thought\n Let's check.\n```\n只认开头。";
    expect(stripThoughtLeak(fenced)).toBe(fenced);
    for (const plain of ["Thoughtful question. Here is the answer.", "Thought it through: two files change.", "两个定时都挂好了 👌", "The build passed."]) {
      expect(stripThoughtLeak(plain)).toBe(plain);
    }
  });
});

describe("the guard every reply goes through", () => {
  it("cuts the thinking: the server stores replies and the chat draws them through it", () => {
    expect(stripLeakedSystemHarnessMessages(LISTED)).toBe(FOUND);
    expect(stripLeakedSystemHarnessMessages(`<SYSTEM_MESSAGE>task done</SYSTEM_MESSAGE>${DRAFTED}`)).toBe(REACTION);
  });

  it("hides a stored reply that was only thinking, and no other", () => {
    expect(isPureLeakedSystemHarnessMessage("💡 Thought\n Forgot `FULL=1`! Let's run with `FULL=1`.")).toBe(true);
    expect(isPureLeakedSystemHarnessMessage(LISTED)).toBe(false);
    expect(isPureLeakedSystemHarnessMessage("Thoughtful question.")).toBe(false);
  });

  // On 2026-11-15 the leak was back and looked as if a fix had come undone: nothing here had ever filtered it. These
  // read the source, so a merge from upstream that rewrites one of the files and drops the call fails here.
  it("is still the one an ACP reply is stored through, and the chat still draws through it", () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
    expect(read("../system-message-guard.ts")).toMatch(/stripThoughtLeak\(/);
    const flush = read("../../server/drivers/acp/core.ts").match(/const flushAssistantText = \(\) => \{[\s\S]*?\n {8}\};/)?.[0] ?? "";
    expect(flush).toMatch(/stripLeakedSystemHarnessMessages\(raw\)/);
    for (const view of ["../../src/components/ChatView.tsx", "../../src/components/GroupView.tsx"]) {
      expect(read(view)).toMatch(/stripLeakedSystemHarnessMessages\(/);
      expect(read(view)).toMatch(/isPureLeakedSystemHarnessMessage\(/);
    }
  });
});
