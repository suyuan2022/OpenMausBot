import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeMessageDb, insertMessage } from "../message-db.ts";
import type { RecentWorkStore } from "../recent-work.ts";
import type { Message, TaskRecord } from "../store.ts";
import {
  ASK_CHARS,
  RECENT_WORK_INTRO,
  RECENT_WORK_MAX_CHARS,
  RECENT_WORK_MAX_LINES,
  recentWork,
  recentWorkEntry,
  recentWorkPrompt,
  RESULT_CHARS,
} from "./recent-work.ts";

const NOW = new Date(2026, 10, 11, 15, 30).getTime();
const at = (hour: number, minute = 0) => new Date(2026, 10, 11, hour, minute).getTime();
const LIZHI = { botId: "lizhi", name: "荔枝" };
const DAFU = { botId: "dafu", name: "大副" };

const task = (threadId: string, extra: Partial<TaskRecord> = {}): TaskRecord =>
  ({ threadId, title: `title of ${threadId}`, createdAt: 1, resumeCursors: {}, ...extra } as TaskRecord);
const opened = (by: { botId: string; name: string }) => ({ openedBy: { ...by, kind: "work" as const, at: 1 } });

let seq = 0;
function say(threadId: string, when: number, text: string, extra: Partial<Message> = {}): string {
  const id = `m${++seq}`;
  insertMessage(threadId, { id, at: when, role: "bot", kind: "text", text, ...extra } as Message);
  return id;
}
/** A teammate's ask: its opening request is a bot line from it; a later one is a user line marked as its. */
const askOpening = (threadId: string, when: number, text: string, by = LIZHI) => say(threadId, when, text, { from: { ...by, color: "red" } });
const askLater = (threadId: string, when: number, text: string, by = LIZHI) => say(threadId, when, text, { role: "user", peerAsk: by });
const reply = (threadId: string, when: number, text: string) => say(threadId, when, text, { turnId: `turn-${seq}`, turnTerminal: true });

const store = (groups: RecentWorkStore["groups"] = []): RecentWorkStore => ({ groups, taskByThread: () => undefined });
const MAUS = "Maus 工程师";
const maus = (tasks: TaskRecord[], extra: { threadId?: string; mainThreadChoice?: string } = {}) =>
  ({ id: "maus", name: MAUS, threadId: extra.threadId ?? "home", tasks, ...(extra.mainThreadChoice ? { mainThreadChoice: extra.mainThreadChoice } : {}) });
const work = (bot: ReturnType<typeof maus>, currentThreadId = "home") => recentWork(store(), bot, { userName: "夙愿", currentThreadId, now: NOW });

beforeEach(() => closeMessageDb());
afterEach(() => closeMessageDb());

describe("a thread another bot opened to hand this one work", () => {
  it("replied: who sent it, its newest ask without the @mention, the bot's finished reply after it, and ids to read both", () => {
    const ask = askOpening("t-carbon", at(2, 50), `@${MAUS} 夙愿今晚让我测 Gemini 4 Carbon，看它写得好不好。`);
    say("t-carbon", at(3, 0), "我先看一眼。", { turnId: "turn-a" });
    const result = reply("t-carbon", at(3, 16), "已经把「内容创作」的默认模型切换为 carbon。");
    const bot = maus([task("home"), task("t-carbon", opened(LIZHI))]);
    const lines = work(bot);
    expect(lines).toHaveLength(1);
    expect(recentWorkPrompt(lines, NOW)).toBe(RECENT_WORK_INTRO +
      "\n- today 03:16 · from 荔枝 · status: replied · thread_id t-carbon" +
      `\n  ask: "夙愿今晚让我测 Gemini 4 Carbon，看它写得好不好。" · message_id ${ask}` +
      `\n  result: "已经把「内容创作」的默认模型切换为 carbon。" · message_id ${result}`);
  });

  it("no reply yet: listed all the same, with no result while the bot's turn is still running or has not begun", () => {
    const ask = askOpening("t-refund", at(15, 2), "查一下退货政策", DAFU);
    askOpening("t-quiet", at(14, 0), "整理一下上周的账单", DAFU);
    say("t-refund", at(15, 10), "我先去翻一下店铺规则。", { turnId: "turn-running" });
    const bot = maus([task("home"), task("t-refund", opened(DAFU)), task("t-quiet", opened(DAFU))]);
    const lines = work(bot);
    expect(lines.map((line) => line.threadId)).toEqual(["t-refund", "t-quiet"]);
    expect(recentWorkEntry(lines[0]!, NOW)).toBe(`\n- today 15:02 · from 大副 · status: no reply yet · thread_id t-refund\n  ask: "查一下退货政策" · message_id ${ask}`);
  });

  it("waiting on the person: the thread waits on their approval or answer, whatever was said", () => {
    askOpening("t-pay", at(9, 0), "付一下这张发票");
    reply("t-pay", at(9, 5), "要你批准付款。");
    const bot = maus([task("home"), task("t-pay", { ...opened(LIZHI), activity: "waiting-on-you" })]);
    expect(recentWorkEntry(work(bot)[0]!, NOW)).toContain("· from 荔枝 · status: waiting on 夙愿 · thread_id t-pay");
  });

  it("a later ask passed in after the reply is the ask, and the older reply is no answer to it", () => {
    askOpening("t-pr", at(1, 0), "修一下 PR 的 CI");
    reply("t-pr", at(2, 0), "修好了，CI 绿了。");
    const later = askLater("t-pr", at(4, 0), "再补一项 J：打字时不该出现停止按钮。");
    const entry = recentWorkEntry(work(maus([task("home"), task("t-pr", opened(LIZHI))]))[0]!, NOW);
    expect(entry).toBe(`\n- today 04:00 · from 荔枝 · status: no reply yet · thread_id t-pr\n  ask: "再补一项 J：打字时不该出现停止按钮。" · message_id ${later}`);
  });

  it("a notice the server wrote is no reply, and neither is another bot's line", () => {
    askOpening("t-watch", at(8, 0), "盯一下这个文件");
    say("t-watch", at(8, 30), "Waiting is over: the file changed.", { textCode: "chat.notice.waitDone.fileChanged" });
    say("t-watch", at(8, 40), "我也看看。", { from: { ...DAFU, color: "blue" } });
    const line = work(maus([task("home"), task("t-watch", opened(LIZHI))]))[0];
    expect(line).toMatchObject({ status: "no reply yet" });
    expect(line).not.toHaveProperty("result");
  });

  it("is in the window by its ask or its result: an old ask answered today is listed, an old exchange is not", () => {
    askOpening("t-old", at(1, 0) - 3 * 86_400_000, "很久以前的活");
    reply("t-old", at(1, 0) - 3 * 86_400_000 + 60_000, "做完了");
    askOpening("t-revived", at(1, 0) - 3 * 86_400_000, "上周派的活");
    reply("t-revived", at(10, 0), "今天终于做完了");
    const lines = work(maus([task("home"), task("t-old", opened(LIZHI)), task("t-revived", opened(LIZHI))]));
    expect(lines.map((line) => line.threadId)).toEqual(["t-revived"]);
  });
});

describe("the bot's own conversations", () => {
  it("in a background run, the home is the main conversation with the person, even a home another bot once opened", () => {
    askOpening("t-job", at(11, 0), "跑一下测试");
    say("chosen", at(10, 0), "早上好，今天三件事。");
    const bot = maus([task("home"), task("chosen", opened(DAFU)), task("t-job", opened(LIZHI))], { mainThreadChoice: "chosen" });
    const lines = work(bot, "t-job");
    expect(lines).toHaveLength(1);
    expect(recentWorkEntry(lines[0]!, NOW)).toMatch(/^\n- today 10:00 · main conversation with 夙愿 · "title of chosen" · thread_id chosen\n {2}you said: "早上好，今天三件事。" · message_id m\d+$/);
  });

  it("a thread the bot opened on itself says so; one the person opened stays a 1:1; a scheduled run is never listed", () => {
    say("t-self", at(12, 0), "三个 PR 都审完了。");
    say("t-person", at(12, 30), "改好了。");
    say("t-run", at(13, 0), "今天的天气：晴。");
    const bot = maus([task("home"), task("t-self", { openedBy: { botId: "maus", name: MAUS, at: 1 } }), task("t-person"), task("t-run", { routineRunId: "run-1" })]);
    const text = recentWorkPrompt(work(bot), NOW);
    expect(text).toContain("\n- today 12:30 · 1:1 with 夙愿 · \"title of t-person\" · thread_id t-person\n");
    expect(text).toContain("\n- today 12:00 · thread you opened · \"title of t-self\" · thread_id t-self\n");
    expect(text).not.toContain("t-run");
  });
});

describe("limits", () => {
  it("cuts each quote, keeps to ten entries, and stops before an entry would pass the budget", () => {
    const tasks = [task("home")];
    for (let n = 0; n < 14; n++) {
      tasks.push(task(`t${n}`, opened(LIZHI)));
      askOpening(`t${n}`, at(1, n), "问".repeat(400));
      reply(`t${n}`, at(2, n), "答".repeat(400));
    }
    const lines = work(maus(tasks));
    expect(lines).toHaveLength(RECENT_WORK_MAX_LINES);
    expect(lines.map((line) => line.threadId).slice(0, 2)).toEqual(["t13", "t12"]);
    const first = lines[0]!;
    expect(first.kind === "asked" && first.ask!.text).toBe(`${"问".repeat(ASK_CHARS - 1)}…`);
    expect(first.kind === "asked" && first.result!.text).toBe(`${"答".repeat(RESULT_CHARS - 1)}…`);
    const text = recentWorkPrompt(lines, NOW);
    const entries = text.split("\n- ").length - 1;
    expect(text.length - RECENT_WORK_INTRO.length).toBeLessThanOrEqual(RECENT_WORK_MAX_CHARS);
    expect(entries).toBeLessThan(RECENT_WORK_MAX_LINES);
    expect(text.length - RECENT_WORK_INTRO.length + recentWorkEntry(lines[entries]!, NOW).length).toBeGreaterThan(RECENT_WORK_MAX_CHARS);
    expect(recentWorkPrompt([], NOW)).toBe("");
  });
});
