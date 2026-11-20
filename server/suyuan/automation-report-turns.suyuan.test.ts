import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { createAutomationReports, newestAutomationLines } from "../automation-reports.ts";
import { DATA_DIR } from "../config.ts";
import type { RoutineRun } from "../routines.ts";
import type { RoutineRunReport } from "../../shared/routines.ts";
import { Store, type BotRecord, type Message } from "../store.ts";
const selection = { instanceId: "claude", model: "claude-sonnet-4-6" };

function fixture() {
  const store = new Store(() => selection);
  const bot = store.createBot({ name: "Lizhi" });
  const main = bot.threadId;
  const runs = new Map<string, RoutineRun>();
  const busy = new Set<string>();
  const notified: Array<{ kind: string; threadId: string; detail: string }> = [];
  const wrote: string[] = [];
  const routines = {
    listRuns: () => [...runs.values()].map((run) => ({ ...run })).reverse(),
    noteReport: (id: string, report: RoutineRunReport | undefined) => {
      const run = runs.get(id);
      if (!run) return null;
      if (report) run.report = report;
      else delete run.report;
      return { ...run };
    },
    runForThread: (threadId: string) => {
      const run = [...runs.values()].findLast((candidate) => candidate.threadId === threadId);
      return run ? { ...run } : null;
    },
  };
  const create = () => createAutomationReports({
    store,
    routines: () => routines,
    busy: (_botId, threadId) => busy.has(threadId),
    wrote: (_bot: BotRecord, threadId) => wrote.push(threadId),
    notify: (kind, _bot, threadId, detail) => notified.push({ kind, threadId, detail }),
  });
  const reports = create();
  let serial = 0;
  const startRun = (name = "Morning video", extra: Partial<RoutineRun> = {}) => {
    const id = `run-${++serial}`;
    const threadId = store.createTask(bot.id, `${name} run`, false)!.threadId;
    store.patchTask(bot.id, threadId, { routineRunId: id });
    store.appendMessage(threadId, { role: "user", kind: "text", text: `[Scheduled routine "${name}" — do this now:]` });
    const run: RoutineRun = {
      id, routineId: `routine-${name}`, routineName: name, target: "bot", botId: bot.id, runOn: "maus",
      scheduledFor: Date.now(), status: "running", manual: false, triggerSource: "schedule",
      threadId, resultsThreadId: main, createdAt: Date.now(), ...extra,
    };
    runs.set(id, run);
    return run;
  };
  const lines = (runId?: string) => store.messagesFor(main).filter((message) => message.automation && (!runId || message.automation.runId === runId));
  return { store, bot, main, runs, busy, notified, wrote, reports, startRun, lines, create };
}

describe("suyuan automation report turns & attachments", () => {
  beforeEach(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it("carries attachments posted by attach_file (separate empty-text messages with no turnId) onto the reported line", () => {
    const f = fixture();
    const run = f.startRun("10 点发晨间视频");
    const video = { kind: "file" as const, path: "/attachments/video.mp4", mime: "video/mp4", name: "晨间视频.mp4" };
    const qr = { kind: "image" as const, path: "/attachments/qr.png", mime: "image/png", name: "扫码.png" };
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "activity", turnId: "t1" });
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "text", text: "", attachments: [video] });
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "text", text: "", attachments: [qr] });
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "text", text: "今天三件要你定。", turnId: "t1", turnTerminal: true });
    run.status = "completed";
    f.reports.runSettled(run, "t1");

    expect(f.lines()).toEqual([expect.objectContaining({
      text: "今天三件要你定。",
      attachments: [video, qr],
    })]);
  });

  it("carries attach_file attachments even when called after text or with no reply text at all", () => {
    const f = fixture();
    const run1 = f.startRun("Text then attach");
    const pdf = { kind: "file" as const, path: "/attachments/doc.pdf", mime: "application/pdf", name: "doc.pdf" };
    f.store.appendMessage(run1.threadId!, { role: "bot", kind: "text", text: "文件发你了。", turnId: "t1", turnTerminal: true });
    f.store.appendMessage(run1.threadId!, { role: "bot", kind: "activity", turnId: "t1" });
    f.store.appendMessage(run1.threadId!, { role: "bot", kind: "text", text: "", attachments: [pdf] });
    run1.status = "completed";
    f.reports.runSettled(run1, "t1");

    const run2 = f.startRun("Attach only");
    const img = { kind: "image" as const, path: "/attachments/only.png", mime: "image/png", name: "only.png" };
    f.store.appendMessage(run2.threadId!, { role: "bot", kind: "activity", turnId: "t2" });
    f.store.appendMessage(run2.threadId!, { role: "bot", kind: "text", text: "", attachments: [img] });
    run2.status = "completed";
    f.reports.runSettled(run2, "t2");

    expect(f.lines()).toEqual([
      expect.objectContaining({ text: "文件发你了。", attachments: [pdf] }),
      expect.objectContaining({ text: "", attachments: [img] }),
    ]);
    expect(f.notified.at(-1)?.detail).toBe("Attach only: only.png");
  });

  it("delivers each turn's reply in a multi-turn run without losing turn 1 or duplicating attachments across turns", () => {
    const f = fixture();
    const run = f.startRun("10 点发晨间视频");
    const video = { kind: "file" as const, path: "/attachments/morning.mp4", mime: "video/mp4", name: "晨间视频.mp4" };
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "activity", turnId: "t1" });
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "text", text: "", attachments: [video] });
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "text", text: "今天三件要你定。", turnId: "t1", turnTerminal: true });
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "digest", text: "[digest]", turnId: "t1" });
    run.status = "waiting";
    f.reports.runSettled(run, "t1");

    // Turn 1 lands immediately while the run waits on a teammate.
    expect(f.lines()).toEqual([expect.objectContaining({
      text: "今天三件要你定。",
      attachments: [video],
      automation: expect.objectContaining({ runId: run.id, turnId: "t1" }),
    })]);

    // Turn 2 resumes after the teammate returns and reports a second line without turn 1's video.
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "activity" });
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "text", text: "小齐羽绒服查完了。", turnId: "t2", turnTerminal: true });
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "digest", text: "[digest]", turnId: "t2" });
    run.status = "completed";
    f.reports.runSettled(run, "t2");

    expect(f.lines().map((m) => ({ text: m.text, attachments: m.attachments }))).toEqual([
      { text: "今天三件要你定。", attachments: [video] },
      { text: "小齐羽绒服查完了。", attachments: undefined },
    ]);
    // Both lines from the newest run stay pinned in conversation context.
    expect([...newestAutomationLines(f.lines())]).toEqual(f.lines().map((m) => m.id));
  });

  it("keeps turn 1's report when turn 2 ends with NOTHING NEW, and never leaks attachments from a quiet turn", () => {
    const f = fixture();
    const run = f.startRun("夜巡");
    const shot = { kind: "image" as const, path: "/attachments/shot.png", mime: "image/png" };
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "text", text: "中间进度句", turnId: "t1" });
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "text", text: "今晚处置了 5 件。", attachments: [shot], turnId: "t1", turnTerminal: true });
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "digest", text: "[digest]", turnId: "t1" });
    run.status = "waiting";
    f.reports.runSettled(run, "t1");

    f.store.appendMessage(run.threadId!, { role: "bot", kind: "text", text: "NOTHING NEW", turnId: "t2", turnTerminal: true });
    run.status = "completed";
    f.reports.runSettled(run, "t2");

    expect(f.lines().map((m) => m.text)).toEqual(["今晚处置了 5 件。"]);
    expect(f.runs.get(run.id)!.report).toMatchObject({ state: "posted", threadId: f.main });

    // A quiet turn with generated screenshots posts nothing and leaks no images into turn 2.
    const quietRun = f.startRun("凌晨夜巡");
    const debugImg = { kind: "image" as const, path: "/attachments/debug.png", mime: "image/png" };
    f.store.appendMessage(quietRun.threadId!, { role: "bot", kind: "text", text: "NOTHING NEW", attachments: [debugImg], turnId: "q1", turnTerminal: true });
    f.store.appendMessage(quietRun.threadId!, { role: "bot", kind: "digest", text: "[digest]", turnId: "q1" });
    quietRun.status = "waiting";
    f.reports.runSettled(quietRun, "q1");
    expect(f.lines()).toHaveLength(1);

    f.store.appendMessage(quietRun.threadId!, { role: "bot", kind: "text", text: "NOTHING NEW", turnId: "q2", turnTerminal: true });
    quietRun.status = "completed";
    f.reports.runSettled(quietRun, "q2");
    expect(f.lines()).toHaveLength(1);
    expect(f.runs.get(quietRun.id)!.report).toEqual({ state: "quiet" });
  });

  it("queues multiple turns in order while the main chat is busy, and recovers pending turns after a restart without duplicates", () => {
    const f = fixture();
    f.busy.add(f.main);
    const run = f.startRun("多轮排队");
    const a1 = { kind: "file" as const, path: "/attachments/a1.mp4", mime: "video/mp4", name: "a1.mp4" };
    const a2 = { kind: "image" as const, path: "/attachments/a2.png", mime: "image/png", name: "a2.png" };
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "text", text: "", attachments: [a1] });
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "text", text: "第一轮结果", turnId: "t1", turnTerminal: true });
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "digest", text: "[digest]", turnId: "t1" });
    run.status = "waiting";
    f.reports.runSettled(run, "t1");

    f.store.appendMessage(run.threadId!, { role: "bot", kind: "text", text: "", attachments: [a2] });
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "text", text: "第二轮结果", turnId: "t2", turnTerminal: true });
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "digest", text: "[digest]", turnId: "t2" });
    run.status = "completed";
    f.reports.runSettled(run, "t2");

    expect(f.lines()).toEqual([]);
    // Simulate a server restart while both turns were pending.
    f.busy.delete(f.main);
    const restarted = f.create();
    restarted.flush();
    restarted.flush();
    expect(f.lines().map((m: Message) => ({ text: m.text, attachments: m.attachments }))).toEqual([
      { text: "第一轮结果", attachments: [a1] },
      { text: "第二轮结果", attachments: [a2] },
    ]);
  });

  it("still posts a failure line if turn 1 succeeded and turn 2 failed", () => {
    const f = fixture();
    const run = f.startRun("半路失败");
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "text", text: "第一轮发完了。", turnId: "t1", turnTerminal: true });
    run.status = "waiting";
    f.reports.runSettled(run, "t1");

    run.status = "failed";
    run.error = "teammate timed out";
    f.reports.runFailed(run, "teammate timed out");

    expect(f.lines().map((m) => ({ text: m.text, failed: m.automation?.failed }))).toEqual([
      { text: "第一轮发完了。", failed: undefined },
      { text: expect.stringContaining("teammate timed out"), failed: true },
    ]);
  });

  it("skips a person's side turn inside the hidden run thread during restart recovery", () => {
    const f = fixture();
    const run = f.startRun("人插话恢复");
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "text", text: "第一轮结论", turnId: "t1", turnTerminal: true });
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "digest", text: "[digest]", turnId: "t1" });
    f.store.appendMessage(run.threadId!, { role: "user", kind: "text", text: "Any news?" });
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "text", text: "给插话人的回复", turnId: "p1", turnTerminal: true });
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "activity" });
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "text", text: "第二轮结论", turnId: "t2", turnTerminal: true });
    run.status = "completed";
    run.report = { state: "pending" };

    f.create().flush();
    expect(f.lines().map((m) => m.text)).toEqual(["第一轮结论", "第二轮结论"]);
  });

  it("recovers queued turn 1 replies and attachments before the failure line after a restart on a failed run", () => {
    const f = fixture();
    f.busy.add(f.main);
    const run = f.startRun("排队后失败重启");
    const vid = { kind: "file" as const, path: "/attachments/t1-video.mp4", mime: "video/mp4", name: "t1-video.mp4" };
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "text", text: "", attachments: [vid] });
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "text", text: "第一轮已完成并附视频。", turnId: "t1", turnTerminal: true, turnSucceeded: true });
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "digest", text: "[digest]", turnId: "t1" });
    run.status = "waiting";
    f.reports.runSettled(run, "t1");

    f.store.appendMessage(run.threadId!, { role: "bot", kind: "text", text: "半截文字", turnId: "t2" });
    run.status = "failed";
    run.error = "provider crashed";
    f.reports.runFailed(run, "provider crashed");

    // Also add a single-turn failed run with partial non-terminal text: must only post the failure line.
    const crashRun = f.startRun("单轮崩溃");
    f.store.appendMessage(crashRun.threadId!, { role: "bot", kind: "text", text: "没跑完的半截", turnId: "c1" });
    crashRun.status = "failed";
    crashRun.error = "socket closed";
    f.reports.runFailed(crashRun, "socket closed");

    f.busy.delete(f.main);
    f.create().flush();

    expect(f.lines(run.id).map((m: Message) => ({ text: m.text, attachments: m.attachments, failed: m.automation?.failed }))).toEqual([
      { text: "第一轮已完成并附视频。", attachments: [vid], failed: undefined },
      { text: expect.stringContaining("provider crashed"), attachments: undefined, failed: true },
    ]);
    expect(f.lines(crashRun.id).map((m: Message) => ({ failed: m.automation?.failed }))).toEqual([
      { failed: true },
    ]);
  });

  it("stamps turnId when recovering a queued-for-retry run so the retry turn is not swallowed by dedup", () => {
    const f = fixture();
    f.busy.add(f.main);
    const run = f.startRun("重启重试");
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "text", text: "第一轮汇报", turnId: "t1", turnTerminal: true, turnSucceeded: true });
    run.status = "waiting";
    f.reports.runSettled(run, "t1");

    // On restart, RoutineManager moves an interrupted run back to queued for automatic retry.
    run.status = "queued";
    f.busy.delete(f.main);
    const restarted = f.create();
    restarted.flush();

    expect(f.lines(run.id).map((m) => ({ text: m.text, turnId: m.automation?.turnId }))).toEqual([
      { text: "第一轮汇报", turnId: "t1" },
    ]);

    // Retry executes as turn 2 and completes.
    f.store.appendMessage(run.threadId!, { role: "user", kind: "text", text: "[Scheduled routine \"重启重试\" — do this now:]\nCheck\n[OpenMausBot: this run's first start stopped when OpenMausBot restarted before it finished.]" });
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "text", text: "重试后的第二轮结论", turnId: "t2", turnTerminal: true, turnSucceeded: true });
    run.status = "completed";
    restarted.runSettled(run, "t2");

    expect(f.lines(run.id).map((m) => m.text)).toEqual(["第一轮汇报", "重试后的第二轮结论"]);
  });

  it("recovers an attach_file-only turn after a text turn on restart", () => {
    const f = fixture();
    const run = f.startRun("二轮纯附件");
    const file2 = { kind: "file" as const, path: "/attachments/report-part2.pdf", mime: "application/pdf", name: "report-part2.pdf" };
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "text", text: "第一轮文字结论", turnId: "t1", turnTerminal: true, turnSucceeded: true });
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "digest", text: "[digest]", turnId: "t1" });
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "activity", turnId: "t2", tool: { name: "attach_file", ok: true } });
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "text", text: "", attachments: [file2] });
    run.status = "completed";
    run.report = { state: "pending" };

    f.create().flush();
    expect(f.lines(run.id).map((m: Message) => ({ text: m.text, attachments: m.attachments }))).toEqual([
      { text: "第一轮文字结论", attachments: undefined },
      { text: "", attachments: [file2] },
    ]);
  });

  it("does not mistake an automatic routine retry prompt for a person side turn on restart", () => {
    const f = fixture();
    const run = f.startRun("自动重试恢复");
    const retryImg = { kind: "image" as const, path: "/attachments/retry.png", mime: "image/png", name: "retry.png" };
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "text", text: "第一轮结果", turnId: "t1", turnTerminal: true, turnSucceeded: true });
    f.store.appendMessage(run.threadId!, {
      role: "user", kind: "text",
      text: "[Scheduled routine \"自动重试恢复\" — do this now:]\nTrigger id: r1\nDo the check.\n[OpenMausBot: this run's first start failed before it finished. If it already did part of the work, check what it did.]",
    });
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "text", text: "", attachments: [retryImg] });
    f.store.appendMessage(run.threadId!, { role: "bot", kind: "text", text: "重试成功的最终结果", turnId: "t2", turnTerminal: true, turnSucceeded: true });
    run.status = "completed";
    run.report = { state: "pending" };

    f.create().flush();
    expect(f.lines(run.id).map((m: Message) => ({ text: m.text, attachments: m.attachments }))).toEqual([
      { text: "第一轮结果", attachments: undefined },
      { text: "重试成功的最终结果", attachments: [retryImg] },
    ]);
  });
});
