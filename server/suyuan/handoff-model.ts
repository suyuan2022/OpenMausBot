// suyuan fork: optional per-handoff model_selection on coordinate_bots. Runs one assignment (or new teammate thread) on a
// chosen engine/model without changing the teammate's default model. Leaving model_selection out keeps upstream behavior,
// and resets an idle standing work thread back to the teammate's default so a one-off override never leaks into later jobs.
import { sameModelSelection } from "../../shared/thread-model.ts";
import type { ModelSelection } from "../contracts.ts";
import { signedOut } from "../default-model-selection.ts";
import type { BotRecord, TaskRecord } from "../store.ts";
import type { ThreadEngine } from "../thread-model.ts";

export const HANDOFF_MODEL_PARAM = {
  type: "object",
  additionalProperties: false,
  properties: {
    instanceId: { type: "string", minLength: 1 },
    model: { type: "string", minLength: 1 },
    effort: { type: "string" },
    variant: { type: "string" },
  },
  required: ["instanceId", "model"],
  description: "Optional: override engine/model for this hand-off only (teammate default stays unchanged). Omit for their default.",
} as const;

export const HANDOFF_MODEL_DESC_SWAP: readonly [upstream: string, fork: string] = [
  "and use their own model, tools and permissions.",
  "and use their own model (or model_selection), tools and permissions.",
];

type Fields = Record<string, unknown>;
const fieldsOf = (value: unknown): Fields | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Fields : null;

/** Models sometimes stringify nested objects in tool arguments. */
function unstringify(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

/** Parses model_selection from coordinate_bots MCP tool arguments before posting to the server. */
export function parseHandoffModelArg(raw: unknown): { ok: true; selection?: Record<string, string> } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true };
  const fields = fieldsOf(unstringify(raw));
  if (!fields || typeof fields.instanceId !== "string" || !fields.instanceId.trim() || typeof fields.model !== "string" || !fields.model.trim()) {
    return { ok: false, error: 'coordinate_bots model_selection must be an object with non-empty instanceId and model, such as {"instanceId":"claude","model":"claude-sonnet-5-5"}.' };
  }
  const extra = Object.keys(fields).filter((key) => !["instanceId", "model", "effort", "variant"].includes(key));
  if (extra.length) {
    return { ok: false, error: `coordinate_bots model_selection only accepts instanceId, model, effort and variant (unexpected: ${extra.join(", ")}).` };
  }
  if ((fields.effort !== undefined && (typeof fields.effort !== "string" || !fields.effort.trim()))
    || (fields.variant !== undefined && (typeof fields.variant !== "string" || !fields.variant.trim()))) {
    return { ok: false, error: "coordinate_bots model_selection effort and variant must be non-empty strings when supplied." };
  }
  const selection: Record<string, string> = { instanceId: fields.instanceId.trim(), model: fields.model.trim() };
  if (typeof fields.effort === "string" && fields.effort.trim()) selection.effort = fields.effort.trim();
  if (typeof fields.variant === "string" && fields.variant.trim()) selection.variant = fields.variant.trim();
  return { ok: true, selection };
}

export interface ValidateHandoffModelInput {
  answers?: string | undefined;
  hasRoomTarget: boolean;
  targets: readonly BotRecord[];
  checkSelection(raw: unknown): { ok: true; selection: ModelSelection } | { ok: false; status: number; error: string };
  validateProposal(selection: ModelSelection, current?: BotRecord): string | null;
  engine(instanceId: string): ThreadEngine | undefined;
  policyRefusal(engine: ThreadEngine): string | undefined;
}

/** Validates an optional model_selection on coordinate_bots before any task is created or enqueued. */
export function validateHandoffModel(
  raw: unknown,
  input: ValidateHandoffModelInput,
): { ok: true; selection?: ModelSelection } | { ok: false; status: number; error: string } {
  if (raw === undefined) return { ok: true };
  if (input.answers) {
    return { ok: false, status: 400, error: "model_selection cannot be used with answers: answering a question continues the teammate's existing turn." };
  }
  if (input.hasRoomTarget) {
    return { ok: false, status: 400, error: "model_selection is only for direct teammate hand-offs, not shared room turns (leave group_id out)." };
  }
  const checked = input.checkSelection(raw);
  if (!checked.ok) return checked;
  const selection = checked.selection;
  const engine = input.engine(selection.instanceId);
  if (!engine || !engine.enabled || engine.snapshot.state !== "available") {
    return { ok: false, status: 400, error: `model instance "${selection.instanceId}" is unavailable` };
  }
  const policy = input.policyRefusal(engine);
  if (policy) return { ok: false, status: 400, error: policy };
  if (signedOut(engine)) {
    return { ok: false, status: 400, error: `model instance "${selection.instanceId}" is signed out — pick a ready engine or sign in first` };
  }
  for (const target of input.targets) {
    const refused = input.validateProposal(selection, target);
    if (refused) return { ok: false, status: 400, error: refused };
  }
  return { ok: true, selection };
}

export type ThreadModelPlan =
  | { kind: "keep" }
  | { kind: "switch"; selection: ModelSelection; previous: ModelSelection | undefined }
  | { kind: "reset"; previous: ModelSelection };

export interface PrepareTargetThreadModelInput {
  selection?: ModelSelection | undefined;
  thread: string;
  senderId: string;
  recipient: Pick<BotRecord, "id" | "name" | "modelSelection">;
  continued?: Pick<TaskRecord, "threadId" | "modelSelection" | "openedBy"> | undefined;
  isHome: boolean;
  busy: boolean;
}

/** Decides how an existing direct teammate thread's model should change for this hand-off, before relay or enqueue. */
export function prepareTargetThreadModel(
  input: PrepareTargetThreadModelInput,
): { ok: true; plan: ThreadModelPlan } | { ok: false; error: string } {
  const { selection, thread, senderId, recipient, continued, isHome, busy } = input;
  if (!continued) return { ok: true, plan: { kind: "keep" } };
  if (selection !== undefined) {
    if (isHome || continued.openedBy?.botId !== senderId) {
      return { ok: false, error: 'model_selection cannot change the model of another conversation (such as a bot\'s main chat); use thread "standing" or "new".' };
    }
    const effective = continued.modelSelection ?? recipient.modelSelection;
    if (sameModelSelection(selection, effective)) return { ok: true, plan: { kind: "keep" } };
    if (busy) {
      return { ok: false, error: `${recipient.name}'s thread is currently busy or queued on ${effective.model}; wait for it to finish, or pass thread "new" to run this assignment on ${selection.model}.` };
    }
    return { ok: true, plan: { kind: "switch", selection, previous: continued.modelSelection } };
  }
  if (thread === "standing" && !isHome && continued.openedBy?.kind === "work" && continued.openedBy.botId === senderId
    && continued.modelSelection !== undefined && !busy) {
    return { ok: true, plan: { kind: "reset", previous: continued.modelSelection } };
  }
  return { ok: true, plan: { kind: "keep" } };
}

export interface ThreadModelOps {
  switchModel(selection: ModelSelection): void;
  followBotModel(): void;
}

export function applyThreadModelPlan(plan: ThreadModelPlan, ops: ThreadModelOps): boolean {
  if (plan.kind === "switch") {
    ops.switchModel(plan.selection);
    return true;
  }
  if (plan.kind === "reset") {
    ops.followBotModel();
    return true;
  }
  return false;
}

export function revertThreadModelPlan(plan: ThreadModelPlan | undefined, ops: ThreadModelOps): void {
  if (!plan || plan.kind === "keep") return;
  if (plan.previous !== undefined) ops.switchModel(plan.previous);
  else ops.followBotModel();
}

export function handoffModelNote(selection: ModelSelection | undefined): string {
  if (!selection) return "";
  const extra = selection.effort ? ` (${selection.effort})` : selection.variant ? ` (${selection.variant})` : "";
  return ` [model: ${selection.instanceId}/${selection.model}${extra}]`;
}
