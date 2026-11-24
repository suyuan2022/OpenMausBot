import { describe, expect, it, vi } from "vitest";
import type { ModelSelection } from "../contracts.ts";
import type { BotRecord, TaskRecord } from "../store.ts";
import type { ThreadEngine } from "../thread-model.ts";
import {
  applyThreadModelPlan,
  HANDOFF_MODEL_PARAM,
  handoffModelNote,
  parseHandoffModelArg,
  prepareTargetThreadModel,
  revertThreadModelPlan,
  validateHandoffModel,
} from "./handoff-model.ts";
import { withThreadFacts } from "./thread-facts.ts";

const CLAUDE_SONNET: ModelSelection = { instanceId: "claude", model: "claude-sonnet-5-5" };
const CLAUDE_OPUS: ModelSelection = { instanceId: "claude", model: "claude-opus-5-5", effort: "high" };
const AGY_NEON: ModelSelection = { instanceId: "antigravity", model: "gemini-4-neon" };

function bot(overrides: Partial<BotRecord> = {}): BotRecord {
  return {
    id: "bot-research",
    name: "Research",
    modelSelection: AGY_NEON,
    approvalMode: "full",
    ...overrides,
  } as BotRecord;
}

function readyEngine(instanceId: string, overrides: Partial<ThreadEngine> = {}): ThreadEngine {
  return {
    instanceId,
    driverKind: instanceId === "claude" ? "claudeAgent" : "antigravityAgent",
    enabled: true,
    models: { default: "claude-sonnet-5-5", options: [{ id: "claude-sonnet-5-5", label: "Sonnet" }, { id: "claude-opus-5-5", label: "Opus" }] },
    capabilities: { modelVariants: false },
    snapshot: { state: "available", authenticated: true },
    ...overrides,
  };
}

describe("parseHandoffModelArg", () => {
  it("accepts undefined/null, object, and JSON-stringified object", () => {
    expect(parseHandoffModelArg(undefined)).toEqual({ ok: true });
    expect(parseHandoffModelArg(null)).toEqual({ ok: true });
    expect(parseHandoffModelArg({ instanceId: " claude ", model: " claude-sonnet-5-5 ", effort: " high " })).toEqual({
      ok: true,
      selection: { instanceId: "claude", model: "claude-sonnet-5-5", effort: "high" },
    });
    expect(parseHandoffModelArg(JSON.stringify({ instanceId: "claude", model: "claude-sonnet-5-5" }))).toEqual({
      ok: true,
      selection: { instanceId: "claude", model: "claude-sonnet-5-5" },
    });
  });

  it("refuses missing fields, blank effort/variant, or unexpected keys", () => {
    expect(parseHandoffModelArg("not-json").ok).toBe(false);
    expect(parseHandoffModelArg({ instanceId: "claude" }).ok).toBe(false);
    expect(parseHandoffModelArg({ instanceId: "", model: "claude-sonnet-5-5" }).ok).toBe(false);
    expect(parseHandoffModelArg({ instanceId: "claude", model: "claude-sonnet-5-5", effort: "   " }).ok).toBe(false);
    expect(parseHandoffModelArg({ instanceId: "claude", model: "claude-sonnet-5-5", extra: 1 }).ok).toBe(false);
  });
});

describe("validateHandoffModel", () => {
  const baseInput = () => ({
    answers: undefined as string | undefined,
    hasRoomTarget: false,
    targets: [bot()],
    checkSelection: (raw: unknown) => ({ ok: true as const, selection: raw as ModelSelection }),
    validateProposal: () => null,
    engine: (id: string) => (id === "claude" ? readyEngine("claude") : readyEngine(id, { snapshot: { state: "available", authenticated: false } })),
    policyRefusal: () => undefined,
  });

  it("returns ok with no selection when omitted", () => {
    expect(validateHandoffModel(undefined, baseInput())).toEqual({ ok: true });
  });

  it("allows overriding a teammate whose default engine is signed out to a ready engine", () => {
    expect(validateHandoffModel(CLAUDE_SONNET, baseInput())).toEqual({ ok: true, selection: CLAUDE_SONNET });
  });

  it("refuses model_selection with answers or on room targets", () => {
    expect(validateHandoffModel(CLAUDE_SONNET, { ...baseInput(), answers: "asgn-1" })).toMatchObject({ ok: false, status: 400 });
    expect(validateHandoffModel(CLAUDE_SONNET, { ...baseInput(), hasRoomTarget: true })).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses disabled, unavailable, policy-blocked, signed-out, or proposal-rejected targets", () => {
    expect(validateHandoffModel(AGY_NEON, baseInput())).toMatchObject({ ok: false, status: 400, error: /signed out/ });
    expect(validateHandoffModel(CLAUDE_SONNET, { ...baseInput(), engine: () => readyEngine("claude", { enabled: false }) })).toMatchObject({ ok: false, status: 400, error: /unavailable/ });
    expect(validateHandoffModel(CLAUDE_SONNET, { ...baseInput(), policyRefusal: () => "Blocked by policy" })).toMatchObject({ ok: false, status: 400, error: "Blocked by policy" });
    expect(validateHandoffModel(CLAUDE_SONNET, { ...baseInput(), validateProposal: () => "Incompatible permissions" })).toMatchObject({ ok: false, status: 400, error: "Incompatible permissions" });
  });
});

describe("prepareTargetThreadModel + apply/revert", () => {
  const standingTask = (modelSelection?: ModelSelection): Pick<TaskRecord, "threadId" | "modelSelection" | "openedBy"> => ({
    threadId: "t-work",
    modelSelection,
    openedBy: { botId: "bot-chief", name: "Chief", threadId: "t-chief", kind: "work", at: 1 },
  });

  it("switches an idle standing thread to the override and reverts on duplicate/error", () => {
    const res = prepareTargetThreadModel({
      selection: CLAUDE_SONNET, thread: "standing", senderId: "bot-chief", recipient: bot(), continued: standingTask(undefined), isHome: false, busy: false,
    });
    expect(res).toEqual({ ok: true, plan: { kind: "switch", selection: CLAUDE_SONNET, previous: undefined } });
    if (!res.ok) return;
    const ops = { switchModel: vi.fn(), followBotModel: vi.fn() };
    expect(applyThreadModelPlan(res.plan, ops)).toBe(true);
    expect(ops.switchModel).toHaveBeenCalledWith(CLAUDE_SONNET);
    revertThreadModelPlan(res.plan, ops);
    expect(ops.followBotModel).toHaveBeenCalledTimes(1);
  });

  it("keeps a busy thread when override matches effective model, and refuses when it differs", () => {
    const same = prepareTargetThreadModel({
      selection: CLAUDE_SONNET, thread: "standing", senderId: "bot-chief", recipient: bot(), continued: standingTask(CLAUDE_SONNET), isHome: false, busy: true,
    });
    expect(same).toEqual({ ok: true, plan: { kind: "keep" } });

    const diff = prepareTargetThreadModel({
      selection: CLAUDE_OPUS, thread: "standing", senderId: "bot-chief", recipient: bot(), continued: standingTask(CLAUDE_SONNET), isHome: false, busy: true,
    });
    expect(diff).toMatchObject({ ok: false, error: /busy or queued/ });
  });

  it("refuses model_selection on home chat or another bot's thread", () => {
    expect(prepareTargetThreadModel({
      selection: CLAUDE_SONNET, thread: "t-home", senderId: "bot-chief", recipient: bot(), continued: standingTask(undefined), isHome: true, busy: false,
    })).toMatchObject({ ok: false, error: /another conversation/ });

    expect(prepareTargetThreadModel({
      selection: CLAUDE_SONNET, thread: "t-other", senderId: "bot-chief", recipient: bot(),
      continued: { threadId: "t-other", openedBy: { botId: "bot-other", name: "Other", at: 1 } }, isHome: false, busy: false,
    })).toMatchObject({ ok: false, error: /another conversation/ });
  });

  it("resets an idle standing thread back to bot default when model_selection is omitted, but keeps explicit threads and busy standing threads", () => {
    const reset = prepareTargetThreadModel({
      selection: undefined, thread: "standing", senderId: "bot-chief", recipient: bot(), continued: standingTask(CLAUDE_SONNET), isHome: false, busy: false,
    });
    expect(reset).toEqual({ ok: true, plan: { kind: "reset", previous: CLAUDE_SONNET } });
    if (reset.ok) {
      const ops = { switchModel: vi.fn(), followBotModel: vi.fn() };
      expect(applyThreadModelPlan(reset.plan, ops)).toBe(true);
      expect(ops.followBotModel).toHaveBeenCalledTimes(1);
      revertThreadModelPlan(reset.plan, ops);
      expect(ops.switchModel).toHaveBeenCalledWith(CLAUDE_SONNET);
    }

    // Busy standing thread: never reset while running/queued.
    expect(prepareTargetThreadModel({
      selection: undefined, thread: "standing", senderId: "bot-chief", recipient: bot(), continued: standingTask(CLAUDE_SONNET), isHome: false, busy: true,
    })).toEqual({ ok: true, plan: { kind: "keep" } });

    // Explicit threadId opened with thread:"new" + model_selection: keep its model on follow-ups.
    expect(prepareTargetThreadModel({
      selection: undefined, thread: "t-custom", senderId: "bot-chief", recipient: bot(),
      continued: { threadId: "t-custom", modelSelection: CLAUDE_SONNET, openedBy: { botId: "bot-chief", name: "Chief", at: 1 } }, isHome: false, busy: false,
    })).toEqual({ ok: true, plan: { kind: "keep" } });
  });

  it("advertises model_selection on coordinate_bots via withThreadFacts and formats receipt notes", () => {
    const tool = {
      name: "coordinate_bots",
      description: "they see only what you send, so include constraints and done_when, and pass files they need in files.",
      inputSchema: { properties: { message: { type: "string" } } },
    };
    const patched = withThreadFacts(tool) as typeof tool & { inputSchema: { properties: Record<string, unknown> } };
    expect(patched.inputSchema.properties.model_selection).toEqual(HANDOFF_MODEL_PARAM);
    expect(patched.description).toContain("model_selection");
    expect(handoffModelNote(undefined)).toBe("");
    expect(handoffModelNote(CLAUDE_OPUS)).toBe(" [model: claude/claude-opus-5-5 (high)]");
  });
});
