// suyuan fork: Chinese words in session_search (recallMessages, mode "all"), auto-recall (mode "any") and memory files.
import { mkdirSync, rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "../config.ts";
import { closeMessageDb, indexMemoryFile, insertMessage, recallMemory, recallMessages } from "../message-db.ts";
import { buildRecall, enoughMatches } from "../recall.ts";
import { composeExecutionPrompt } from "../routine-execution.ts";
import type { Message } from "../store.ts";
import { webhookNote, webhookRunNote } from "../webhooks.ts";
import { recallTerms } from "./han-search.ts";

let clock = 1_000;
const line = (id: string, text: string, more: Partial<Message> = {}): Message => ({ id, role: "bot", kind: "text", text, at: (clock += 1_000), ...more });
const ids = (hits: ReadonlyArray<{ messageId: string }>) => hits.map((hit) => hit.messageId);

beforeEach(() => {
  closeMessageDb();
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
});

describe("session_search with Chinese words", () => {
  it("finds a two- or three-character word inside a run of Han characters, which FTS keeps as one token", () => {
    insertMessage("home", line("m1", "已经把内容创作的默认模型切换为 Gemini"));
    insertMessage("home", line("m2", "拼多多最近几单是鞋垫、手机壳这些"));
    insertMessage("other-bot", line("m3", "别人的默认模型"));

    expect(ids(recallMessages("模型", ["home"]))).toEqual(["m1"]);
    expect(ids(recallMessages("手机壳", ["home"]))).toEqual(["m2"]);
    expect(recallMessages("模型", ["home"])[0]!.snippet).toBe("已经把内容创作的默认[模型]切换为 Gemini");
    expect(recallMessages("模型", [])).toEqual([]);
  });

  it("needs every word in one message: Chinese ones anywhere, English words and numbers as whole words, even against Han", () => {
    insertMessage("home", line("both", "#1146 那三件事里，报错原文先脱敏"));
    insertMessage("home", line("glued", "1146脱敏的改动还没合"));
    insertMessage("home", line("one", "脱敏规则写好了"));
    insertMessage("home", line("longer", "11467 也脱敏了"));
    insertMessage("home", line("header", "请求头里 Authorization 这类要脱敏"));

    expect(ids(recallMessages("1146 脱敏", ["home"])).sort()).toEqual(["both", "glued"]);
    expect(ids(recallMessages("脱敏 authorization", ["home"]))).toEqual(["header"]);
    expect(ids(recallMessages("the 脱敏 规则", ["home"]))).toEqual(["one"]);
  });

  it("keeps the time window and ranks a message with more of the word first, digests last", () => {
    insertMessage("home", line("old", "宝可梦的卡带", { at: 100 }));
    insertMessage("home", line("digest", "宝可梦 宝可梦", { kind: "digest" }));
    insertMessage("home", line("once", "提醒事项里有一条：买宝可梦的卡带，原定 11/1，已经过期了还没勾掉，买了就去勾一下"));
    insertMessage("home", line("twice", "宝可梦那条不碰了，宝可梦的查询也停了"));

    expect(ids(recallMessages("宝可梦", ["home"], 12, { since: 500 }))).toEqual(["twice", "once", "digest"]);
    expect(recallMessages("宝可梦", ["home"], 12, { since: 500 }).at(-1)).toMatchObject({ kind: "digest" });
  });
});

describe("routine runs", () => {
  const routine = (trigger: "schedule" | "manual") => ({ id: "r1", name: "找冬装", trigger, runOn: "maus" as const });

  it("never returns the instruction a run is handed, and ranks what runs said after the rest", () => {
    insertMessage("run-1", line("ask-1", composeExecutionPrompt(routine("schedule"), "给小齐找冬装，加进购物车", undefined), { role: "user" }));
    insertMessage("run-1", line("found-1", "找到三件冬装，已加购"));
    insertMessage("run-2", line("ask-2", composeExecutionPrompt(routine("manual"), "给小齐找冬装，加进购物车", undefined), { role: "user" }));
    insertMessage("run-3", line("ask-3", `${webhookRunNote("看大副")}\n大副那边的冬装状态变了`, { role: "user" }));
    insertMessage("run-4", line("event-4", `${webhookNote("看大副")}\n冬装到货`, { role: "user" }));
    insertMessage("run-4", line("said-4", "冬装到货了"));
    insertMessage("home", line("said-home", "冬装先看厚款", { at: 1 }));

    const threads = ["home", "run-1", "run-2", "run-3", "run-4"];
    const all = ids(recallMessages("冬装", threads));
    expect(all[0]).toBe("said-home");
    // A webhook's run line carries that event's data, so it stays, ranked with the runs.
    expect(all.slice(1).sort()).toEqual(["ask-3", "event-4", "found-1", "said-4"]);
    expect(ids(recallMessages("冬装 购物车", threads))).toEqual([]);
    expect(ids(recallMessages("找冬装 加购", threads, 12, undefined, "any"))[0]).toBe("said-home");
  });

  it("stops ranking a run's conversation last once the person writes in it, as upstream clears its routineRunId", () => {
    insertMessage("home", line("said-home", "冬装找到了，三件厚款都放进购物车了，等你挑", { at: 1 }));
    insertMessage("run", line("ask-run", composeExecutionPrompt(routine("schedule"), "找冬装", undefined), { role: "user" }));
    insertMessage("run", line("said-run", "冬装找到了"));
    expect(ids(recallMessages("冬装", ["home", "run"]))).toEqual(["said-home", "said-run"]);
    insertMessage("run", line("peer", "冬装那边怎么样", { role: "user", peerAsk: { botId: "b2", name: "穿搭" } } as Partial<Message>));
    expect(ids(recallMessages("冬装", ["home", "run"]))[0]).toBe("said-home");
    insertMessage("run", line("he-said", "这件不要", { role: "user" }));
    expect(ids(recallMessages("冬装", ["home", "run"]))[0]).toBe("said-run");
  });

  it("ranks a run's line after the rest only in a conversation the run opened, not where a routine runs in the bot's own chat", () => {
    insertMessage("home", line("hello", "你好", { role: "user" }));
    insertMessage("home", line("ask", composeExecutionPrompt(routine("schedule"), "找冬装", undefined), { role: "user" }));
    insertMessage("home", line("said-home", "冬装找到了，三件厚款都放进购物车了，等你挑", { at: 1 }));
    insertMessage("run", line("ask-run", composeExecutionPrompt(routine("schedule"), "找冬装", undefined), { role: "user" }));
    insertMessage("run", line("said-run", "冬装找到了"));
    // The shorter, newer line would rank first by itself.
    expect(ids(recallMessages("冬装", ["home", "run"]))).toEqual(["said-home", "said-run"]);
    expect(ids(recallMessages("冬装", ["run", "other"]))).toEqual(["said-run"]);
  });
});

describe("auto-recall with Chinese", () => {
  it("cuts a sentence into words, drops filler, joins one-character pieces, and keeps a long clause whole", () => {
    expect(recallTerms("上次那个手机壳磁吸的你还记得吗")).toEqual(["手机", "壳磁吸", "壳磁", "磁吸", "手机壳", "上次那个手机壳磁吸的你还记得吗"]);
    expect(recallTerms("帮我看看宝可梦")).toEqual(["宝可梦", "宝可", "可梦", "帮我看看宝可梦"]);
    expect(recallTerms("姐夫就是音译的意思")).toEqual(["姐夫", "音译", "姐夫就是音译的意思"]);
    expect(recallTerms("用Codex跑了模型")).toEqual(["codex", "模型", "用codex跑了模型"]);
    expect(recallTerms("What is my balance?")).toEqual(["balance"]);
  });

  it("keeps a date whole, as upstream does, drops a one- or two-digit number, and joins a letter to the character after it", () => {
    expect(recallTerms("11/12那天退货了没，改了3处")).toEqual(["11/12", "退货", "11/12那天退货了没", "改了3处"]);
    expect(recallTerms("上次那件T恤洗了会不会缩水")).toEqual(["t恤", "缩水", "上次那件t恤洗了会不会缩水"]);
    insertMessage("work", line("date", "11月12日的账单已经发你了"));
    insertMessage("work", line("shirt", "这件T恤是纯棉的，洗了不会缩"));
    const hits = ids(recallMessages("11/12那天的T恤", ["work"], 12, undefined, "any"));
    expect(hits).toEqual(["shirt"]);
  });

  it("recalls the original line from another conversation for a sentence in plain Chinese", () => {
    insertMessage("work", line("w1", "记录找到了：手机壳那次跑过的命令里，B 站一次都没打开过"));
    insertMessage("work", line("w2", "今天天气不错"));
    const result = buildRecall({ botId: "bot", message: "上次买手机壳的时候你是不是没打开B站？", threadIds: ["work"], label: () => "chat", author: () => "shopping" });
    expect(result?.conversations).toBe(1);
    expect(result?.text).toContain("shopping: 记录找到了：手机壳那次跑过的命令里，B 站一次都没打开过");
  });

  it("counts the words a passage holds, not the brackets in it, and a word with the pieces made from it once", () => {
    // 小齐, 冬装, 购物车, 羽绒服, 围巾: five words, so a passage needs two of them.
    const query = "给小齐找冬装加购物车再看看羽绒服和围巾";
    expect(enoughMatches(query, "原文自带 [1] 和 [2]，只提到 [冬装]")).toBe(false);
    expect(enoughMatches(query, "[购物车]里的[购物]清单")).toBe(false);
    expect(enoughMatches(query, "[冬装] 和[羽绒服]都加进购物车了")).toBe(true);
    // Time words and "remind" are filler, as upstream drops "remind": four words left, so one is enough.
    expect(enoughMatches("明天早上提醒我给妈妈打电话，问问她体检结果", "体检报告出来了")).toBe(true);
  });
});

describe("memory files with Chinese", () => {
  it("finds a word inside a run of Han characters, and auto-recall still skips MEMORY.md", () => {
    const stat = { mtimeMs: 1, bytes: 1 };
    indexMemoryFile("bot", "memory/购物.md", "# 购物\n- 京东账号限制登录到十一月中旬", stat);
    indexMemoryFile("bot", "MEMORY.md", "- 京东只查价", stat);
    indexMemoryFile("other", "memory/购物.md", "京东", stat);

    expect(recallMemory("京东 登录", "bot").map((hit) => hit.file)).toEqual(["memory/购物.md"]);
    expect(recallMemory("京东", "bot").map((hit) => hit.file).sort()).toEqual(["MEMORY.md", "memory/购物.md"]);
    expect(recallMemory("京东账号的事", "bot", 12, "any").map((hit) => hit.file)).toEqual(["memory/购物.md"]);
    expect(recallMemory("京东", "bot")[0]!.snippet).toContain("[京东]");
  });
});
