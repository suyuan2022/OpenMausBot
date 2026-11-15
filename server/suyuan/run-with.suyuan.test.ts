import { describe, expect, it } from "vitest";

import { CHECK_MARK } from "../../shared/suyuan/check-first.ts";
import { PLAIN_MARK } from "../../shared/suyuan/plain-reminder.ts";
import { takeRunWith, type RunWithDeps } from "./run-with.ts";

const MODELS = [{ id: "claude-fable-5-2" }, { id: "claude-opus-5-5" }, { id: "claude-sonnet-5-5" }, { id: "claude-sonnet-5" }, { id: "claude-haiku-5-5" }, { id: "claude-haiku-4-5" }];

function deps(routines: Array<{ id: string; botId: string; prompt: string; schedule?: { type: string } }> = [], models = MODELS, full = true) {
  const set: Array<{ id: string; model: string | null }> = [], checks: Array<{ id: string; on: boolean }> = [];
  const made: RunWithDeps = {
    routine: (id) => routines.find((routine) => routine.id === id),
    engine: () => ({ instanceId: "claude", models }),
    setModel: (id, selection) => { set.push({ id, model: selection?.model ?? null }); return null; },
    mayRun: () => full,
    setCheck: (id, on) => { checks.push({ id, on }); return null; },
  };
  return { made, set, checks };
}

describe("run_with on a schedule the trigger tool sends", () => {
  it("none marks the instructions as the message itself, and leaves the request as upstream reads it", () => {
    const { made, set } = deps();
    const routine: Record<string, unknown> = { name: "供暖", instructions: "记得问物业供暖", schedule: { type: "once", at: "2026-11-17T09:00:00+08:00" }, runWith: "none" };
    const step = takeRunWith({ action: "create", routine }, "bot-1", made);
    expect(step.error).toBeUndefined();
    expect(routine).toEqual({ name: "供暖", instructions: `${PLAIN_MARK}\n记得问物业供暖`, schedule: { type: "once", at: "2026-11-17T09:00:00+08:00" } });
    const answer: Record<string, unknown> = { state: "applied", summary: "Created", result: { resultId: "r-1" } };
    step.applied(answer);
    expect(set).toEqual([{ id: "r-1", model: null }]);
    expect(answer.summary).toContain("No AI runs");
  });

  it("haiku and sonnet give the routine the newest such model of the bot's engine, once the request applied", () => {
    const { made, set } = deps();
    const routine: Record<string, unknown> = { name: "查证书", instructions: "查证书到期日", runWith: "haiku" };
    const step = takeRunWith({ action: "create", routine }, "bot-1", made);
    expect(routine).toEqual({ name: "查证书", instructions: "查证书到期日" });
    expect(set).toEqual([]);
    step.applied({ state: "applied", result: { resultId: "r-2" } });
    expect(set).toEqual([{ id: "r-2", model: "claude-haiku-5-5" }]);
    const sonnet = takeRunWith({ action: "create", routine: { name: "a", instructions: "b", runWith: "sonnet" } }, "bot-1", made);
    sonnet.applied({ resultId: "r-3" });
    expect(set.at(-1)).toEqual({ id: "r-3", model: "claude-sonnet-5-5" });
  });

  it("model_selection names the engine and model outright, as a dispatch table's row would", () => {
    const { made, set } = deps([{ id: "r-2", botId: "bot-1", prompt: `${PLAIN_MARK}\n记得带伞` }]);
    const routine: Record<string, unknown> = { name: "查价", instructions: "查一下价格", modelSelection: { instanceId: "codex", model: "gpt-6-astra", effort: "medium" } };
    takeRunWith({ action: "create", routine }, "bot-1", made).applied({ state: "applied", result: { resultId: "r-9" } });
    expect(routine).toEqual({ name: "查价", instructions: "查一下价格" });
    expect(set).toEqual([{ id: "r-9", model: "gpt-6-astra" }]);
    const changes: Record<string, unknown> = { modelSelection: { instanceId: "claude", model: "claude-haiku-5-5" } };
    takeRunWith({ action: "update", routineId: "r-2", changes }, "bot-1", made).applied({ state: "applied", result: { resultId: "r-2" } });
    expect(changes).toEqual({ instructions: "记得带伞" });
    expect(takeRunWith({ action: "create", routine: { name: "a", instructions: "b", runWith: "haiku", modelSelection: { instanceId: "claude", model: "x" } } }, "bot-1", made).error).toMatch(/not both/);
  });

  it("refuses a model the bot's engine does not offer, and a word it does not know", () => {
    const { made } = deps([], [{ id: "gpt-6-astra" }]);
    expect(takeRunWith({ action: "create", routine: { name: "a", instructions: "b", runWith: "haiku" } }, "bot-1", made).error).toMatch(/offers no haiku model/);
    expect(takeRunWith({ action: "create", routine: { name: "a", instructions: "b", runWith: "cheap" } }, "bot-1", made).error).toMatch(/run_with must be/);
    expect(takeRunWith({ action: "create", routine: { name: "a", instructions: " ", runWith: "none" } }, "bot-1", made).error).toMatch(/must be that message/);
  });

  it("an update of run_with alone applies at once, with nothing left for the routine request", () => {
    const { made, set } = deps([{ id: "r-1", botId: "bot-1", prompt: "查证书到期日" }]);
    const changes: Record<string, unknown> = { runWith: "haiku" };
    const step = takeRunWith({ action: "update", routineId: "r-1", changes }, "bot-9", made);
    expect(step.done).toEqual({ resultId: "r-1", summary: "Each run uses claude-haiku-5-5." });
    expect(set).toEqual([{ id: "r-1", model: "claude-haiku-5-5" }]);
    expect(changes).toEqual({});
  });

  it("an update to none marks the instructions it has; back to the bot's model unmarks them and clears the model", () => {
    const { made, set } = deps([{ id: "r-1", botId: "bot-1", prompt: "记得带伞" }, { id: "r-2", botId: "bot-1", prompt: `${PLAIN_MARK}\n记得带伞` }]);
    const toPlain: Record<string, unknown> = { runWith: "none" };
    takeRunWith({ action: "update", routineId: "r-1", changes: toPlain }, "bot-1", made).applied({ state: "applied", result: { resultId: "r-1" } });
    expect(toPlain).toEqual({ instructions: `${PLAIN_MARK}\n记得带伞` });
    const back: Record<string, unknown> = { runWith: "bot" };
    takeRunWith({ action: "update", routineId: "r-2", changes: back }, "bot-1", made).applied({ state: "applied", result: { resultId: "r-2" } });
    expect(back).toEqual({ instructions: "记得带伞" });
    expect(set).toEqual([{ id: "r-1", model: null }, { id: "r-2", model: null }]);
  });

  it("new instructions for a plain reminder stay plain, and a request without run_with is left alone otherwise", () => {
    const { made, set } = deps([{ id: "r-2", botId: "bot-1", prompt: `${PLAIN_MARK}\n记得带伞` }, { id: "r-3", botId: "bot-1", prompt: "查证书" }]);
    const reworded: Record<string, unknown> = { instructions: "记得带伞和外套" };
    expect(takeRunWith({ action: "update", routineId: "r-2", changes: reworded }, "bot-1", made).done).toBeUndefined();
    expect(reworded).toEqual({ instructions: `${PLAIN_MARK}\n记得带伞和外套` });
    const plainEdit: Record<string, unknown> = { instructions: "查证书和域名" };
    takeRunWith({ action: "update", routineId: "r-3", changes: plainEdit }, "bot-1", made).applied({ result: { resultId: "r-3" } });
    expect(plainEdit).toEqual({ instructions: "查证书和域名" });
    takeRunWith({ action: "pause", routineId: "r-3" }, "bot-1", made).applied({});
    expect(set).toEqual([]);
  });
});

describe("only_if on a schedule the trigger tool sends", () => {
  const every = { type: "interval", everyMinutes: 15 };

  it("puts the command in front of the instructions and turns the routine's command check on once it applied", () => {
    const { made, set, checks } = deps();
    const routine: Record<string, unknown> = { name: "微信新消息", instructions: "把新消息整理成三行告诉夙愿", schedule: every, onlyIf: " ~/.local/bin/wx-fresh-check.sh ", runWith: "haiku" };
    const step = takeRunWith({ action: "create", routine }, "bot-1", made);
    expect(step.error).toBeUndefined();
    expect(routine).toEqual({ name: "微信新消息", instructions: `${CHECK_MARK}~/.local/bin/wx-fresh-check.sh\n把新消息整理成三行告诉夙愿`, schedule: every });
    const answer: Record<string, unknown> = { state: "applied", summary: "Created", result: { resultId: "r-1" } };
    step.applied(answer);
    expect(checks).toEqual([{ id: "r-1", on: true }]);
    expect(set).toEqual([{ id: "r-1", model: "claude-haiku-5-5" }]);
    expect(answer.summary).toMatch(/first runs `~\/\.local\/bin\/wx-fresh-check\.sh` with no AI/);
  });

  it("goes with a plain reminder: the command decides, the text is sent as it is", () => {
    const { made, checks } = deps();
    const routine: Record<string, unknown> = { name: "包裹", instructions: "包裹到了，去拿", schedule: every, onlyIf: "test -f /tmp/arrived", runWith: "none" };
    takeRunWith({ action: "create", routine }, "bot-1", made).applied({ state: "applied", result: { resultId: "r-2" } });
    expect(routine.instructions).toBe(`${CHECK_MARK}test -f /tmp/arrived\n${PLAIN_MARK}\n包裹到了，去拿`);
    expect(checks).toEqual([{ id: "r-2", on: true }]);
  });

  it("keeps the command when only the instructions are rewritten, and takes it away on an empty only_if", () => {
    const existing = { id: "r-3", botId: "bot-1", prompt: `${CHECK_MARK}test -f /tmp/x\n旧的说明`, schedule: every };
    const { made, checks } = deps([existing]);
    const rewritten: Record<string, unknown> = { instructions: "新的说明" };
    takeRunWith({ action: "update", routineId: "r-3", changes: rewritten }, "bot-1", made).applied({ state: "applied" });
    expect(rewritten).toEqual({ instructions: `${CHECK_MARK}test -f /tmp/x\n新的说明` });
    expect(checks).toEqual([]);
    const removed: Record<string, unknown> = { onlyIf: "" };
    const step = takeRunWith({ action: "update", routineId: "r-3", changes: removed }, "bot-1", made);
    expect(removed).toEqual({ instructions: "旧的说明" });
    const answer: Record<string, unknown> = { state: "applied", summary: "Updated" };
    step.applied(answer);
    expect(checks).toEqual([{ id: "r-3", on: false }]);
    expect(answer.summary).toContain("no longer runs a command first");
  });

  it("reads a command the instructions already carry, so text copied back from a routine keeps its check", () => {
    const { made, checks } = deps();
    const routine: Record<string, unknown> = { name: "a", instructions: `${CHECK_MARK}test -f /tmp/x\n做事`, schedule: every };
    takeRunWith({ action: "create", routine }, "bot-1", made).applied({ state: "applied", result: { resultId: "r-4" } });
    expect(routine.instructions).toBe(`${CHECK_MARK}test -f /tmp/x\n做事`);
    expect(checks).toEqual([{ id: "r-4", on: true }]);
  });

  it("refuses a schedule that runs once, a bot below Full access, several lines, and a command with nothing to do after it", () => {
    const { made } = deps();
    const once = { type: "once", at: "2026-11-17T09:00:00+08:00" };
    expect(takeRunWith({ action: "create", routine: { name: "a", instructions: "b", schedule: once, onlyIf: "true" } }, "bot-1", made).error).toMatch(/schedule that repeats/);
    expect(takeRunWith({ action: "create", routine: { name: "a", instructions: "b", schedule: every, onlyIf: "true\nrm -rf x" } }, "bot-1", made).error).toMatch(/one shell command on one line/);
    expect(takeRunWith({ action: "create", routine: { name: "a", instructions: " ", schedule: every, onlyIf: "true" } }, "bot-1", made).error).toMatch(/needs instructions/);
    expect(takeRunWith({ action: "create", routine: { name: "a", instructions: "b", schedule: every, onlyIf: "true" } }, "bot-1", deps([], MODELS, false).made).error).toMatch(/Full access/);
  });

  it("does not set the check when the request did not apply", () => {
    const { made, checks } = deps();
    takeRunWith({ action: "create", routine: { name: "a", instructions: "b", schedule: every, onlyIf: "true" } }, "bot-1", made).applied({ state: "pending", resultId: "x" });
    expect(checks).toEqual([]);
  });
});
