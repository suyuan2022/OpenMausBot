// suyuan fork: what a scheduled routine runs with. The trigger tool's run_with says it: "none" sends the instructions as
// they are with no AI (shared/suyuan/plain-reminder.ts), "haiku" and "sonnet" give its runs a cheaper model than the
// bot's own, "bot" goes back to the bot's model; model_selection names any engine and model outright, so a row of a
// dispatch table (kind of work -> engine, model, effort, or no model) can be copied into the call as it stands.
// The routine request the tool sends has no field for either, so this
// reads run_with off the request before it is checked, puts the plain mark into the instructions, and sets the routine's
// own model (upstream's Routine.modelSelection, which the Automations page already saves) once the request applied.
// only_if is a shell command the routine runs first, with no AI: only exit 0 lets it run (shared/suyuan/check-first.ts).
// It goes into the instructions the same way, and the routine gets the "command" check once the request applied.
import { afterCheck, checkFirst, withCheck } from "../../shared/suyuan/check-first.ts";
import { asPlain, plainText, withoutPlainMark } from "../../shared/suyuan/plain-reminder.ts";
import type { ModelSelection } from "../../shared/wire.ts";

export const RUN_WITH = ["none", "haiku", "sonnet", "bot"] as const;
export type RunWith = (typeof RUN_WITH)[number];

/** The spec the trigger tool shows for run_with; server/drivers/agents-catalog.ts spreads it into the trigger's fields. */
export const RUN_WITH_SCHEMA = {
  run_with: {
    type: "string",
    enum: [...RUN_WITH],
    description:
      "Schedules only. none = no AI runs: at the time, instructions is posted as your message, word for word, so write it as the finished message. Use none for every plain reminder, where nothing is looked up or decided at that time. haiku = the cheapest model, for runs that only fetch, check or relay. sonnet = mid-priced. Omit (or bot) for your own model.",
  },
  model_selection: {
    type: "object",
    additionalProperties: false,
    description: "Schedules only, in place of run_with: the exact engine and model of each run, as in propose_model.",
    properties: { instanceId: { type: "string" }, model: { type: "string" }, effort: { type: "string" } },
    required: ["instanceId", "model"],
  },
  only_if: {
    type: "string",
    description: "Repeating schedules only: one shell command run first, with no AI. Exit 0 runs this, its output added to instructions; any other exit skips that time silently and free. Use it to watch for something (a file, new messages) instead of running an AI to look. \"\" removes it.",
  },
} as const;

type Proposal = { action: string; routine?: unknown; routineId?: string; changes?: unknown };
type Fields = Record<string, unknown>;

export interface RunWithDeps {
  /** A routine as it stands, for an update. */
  routine(id: string): { id: string; botId: string; prompt: string; schedule?: { type: string }; checks?: readonly string[] } | undefined;
  /** The engine a bot runs on, with the models it offers, newest first. */
  engine(botId: string): { instanceId: string; models: ReadonlyArray<{ id: string }> } | undefined;
  /** Sets or clears a routine's own model; answers with why it could not. */
  setModel(routineId: string, selection: ModelSelection | null): string | null;
  /** Whether this bot may have a command run unasked: only at Full access. */
  mayRun(botId: string): boolean;
  /** Turns a routine's command check on or off; answers with why it could not. */
  setCheck(routineId: string, on: boolean): string | null;
  /** The routine changed again after its request applied: the request's Undo follows it, so it still works. */
  undoFollows(threadId: string, messageId: string, routineId: string): void;
}

export interface RunWithStep {
  error?: string;
  /** Called with what the routine request answered, in the conversation that asked: sets the model and the check on
   * the routine it created or changed. */
  applied(result: unknown, threadId: string): void;
}

const NOTHING: RunWithStep = { applied: () => {} };
const refuse = (error: string): RunWithStep => ({ ...NOTHING, error });
const fieldsOf = (value: unknown): Fields | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Fields : null;

/** Models stringify nested objects. */
function parsed(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

function resultId(result: unknown): string | undefined {
  const fields = fieldsOf(result), inner = fieldsOf(fields?.result);
  const id = fields?.state === "applied" || fields?.state === undefined ? fields?.resultId ?? inner?.resultId : undefined;
  return typeof id === "string" ? id : undefined;
}

/** Reads run_with, model_selection and only_if off a schedule request from the trigger tool, leaving the request as
 * upstream expects it. `botId` owns the routine; `fromFull` says the conversation asking is at Full access. Nothing is
 * set here: the request still goes through upstream, which checks whose routine it is and who may change it. */
export function takeRunWith(proposal: Proposal, botId: string, deps: RunWithDeps, fromFull: boolean): RunWithStep {
  const fields = fieldsOf(proposal.action === "create" ? proposal.routine : proposal.action === "update" ? proposal.changes : null);
  if (!fields) return NOTHING;
  const raw = fields.runWith, exact = fieldsOf(parsed(fields.modelSelection)), onlyIf = fields.onlyIf;
  if (fields.modelSelection != null && !exact) return refuse('model_selection must be an object such as {"instanceId":"claude","model":"claude-haiku-5-5"}.');
  for (const key of ["runWith", "modelSelection", "onlyIf"]) delete fields[key];
  if (raw !== undefined && !RUN_WITH.includes(raw as RunWith)) return refuse("run_with must be none, haiku, sonnet or bot.");
  if (raw !== undefined && exact) return refuse("Choose run_with or model_selection, not both.");
  if (onlyIf !== undefined && (typeof onlyIf !== "string" || /[\r\n]/.test(onlyIf.trim()) || onlyIf.length > 500))
    return refuse("only_if must be one shell command on one line of at most 500 characters. Put longer logic in a script and call it.");
  // An exact model is a model for the routine, like haiku: it clears a plain mark and is checked when it is set.
  const runWith = exact ? "exact" as const : raw as RunWith | undefined;
  const existing = proposal.action === "update" && proposal.routineId ? deps.routine(proposal.routineId) : undefined;
  // Not there, or another bot's: upstream answers so, and what was read off the request is dropped.
  if (proposal.action === "update" && existing?.botId !== botId) return NOTHING;

  // The instructions are a command to run first, if any, and then what to do; each half changes on its own.
  const given = typeof fields.instructions === "string" ? fields.instructions : undefined;
  const wasCommand = checkFirst(existing?.prompt)?.command, givenCheck = given === undefined ? null : checkFirst(given);
  const written = givenCheck ? givenCheck.rest : given, was = afterCheck(existing?.prompt ?? "");
  const wasPlain = plainText(was) !== null;
  // only_if names the command and "" takes it away; instructions that carry the mark name it too; otherwise it stays.
  const command = onlyIf !== undefined ? (onlyIf as string).trim() || undefined : givenCheck?.command ?? wasCommand;
  // A routine with upstream's checks keeps them: the command check does not go with them.
  const theirs = existing?.checks?.some((one) => one !== "command") === true;
  const check = (onlyIf !== undefined || givenCheck) && !(theirs && !command) ? command !== undefined : undefined;
  if (check) {
    const schedule = fieldsOf(fields.schedule)?.type ?? existing?.schedule?.type;
    if (schedule === "once" || schedule === "limit_reset") return refuse("only_if needs a schedule that repeats (interval, daily, weekly or cron): it checks at each occurrence until the automation is paused.");
    if (theirs) return refuse("This automation already runs checks of its own (calendar, mail or runs), and only_if does not go with them.");
    if (!fromFull || !deps.mayRun(botId)) return refuse("only_if runs a shell command unasked, so the bot and this conversation must be at Full access.");
  }

  let rest: string | undefined;
  if (runWith === "none" || (runWith === undefined && wasPlain && written !== undefined)) {
    const text = withoutPlainMark(written ?? was).trim();
    if (!text) return refuse("run_with none sends instructions as the message itself, so instructions must be that message.");
    rest = asPlain(text);
  } else if (runWith !== undefined && (wasPlain || written !== undefined)) {
    rest = withoutPlainMark(written ?? was);
  } else if (written !== undefined) rest = written;
  if (rest !== undefined || command !== wasCommand) {
    if (command && !(rest ?? was).trim()) return refuse("only_if needs instructions: what to do when the command exits 0.");
    fields.instructions = withCheck(command, rest ?? was);
  }
  if (runWith === undefined && check === undefined) return NOTHING;

  let selection: ModelSelection | null = exact ? exact as unknown as ModelSelection : null;
  if (runWith === "haiku" || runWith === "sonnet") {
    const engine = deps.engine(botId);
    const model = engine?.models.find((candidate) => candidate.id.toLowerCase().includes(runWith));
    if (!engine || !model) return refuse(`This bot's engine offers no ${runWith} model, so run_with ${runWith} cannot apply. Leave run_with out to run on the bot's own model, or use none for a plain reminder.`);
    selection = { instanceId: engine.instanceId, model: model.id };
  }
  const said = [
    runWith === undefined ? "" : selection ? `Each run uses ${selection.model}.` : runWith === "none" ? "No AI runs: the instructions are posted as the message." : "Each run uses the bot's own model.",
    check === undefined ? "" : check ? `It first runs \`${command}\` with no AI; only exit 0 goes on, any other exit skips that time silently.` : "It no longer runs a command first.",
  ].filter(Boolean).join(" ");
  // What could not be set, in words; empty when all of it was.
  const set = (id: string): string => [
    runWith === undefined ? null : deps.setModel(id, selection),
    check === undefined ? null : deps.setCheck(id, check),
  ].filter(Boolean).join(" ");
  // run_with alone still goes through upstream as a change: the instructions, sent as they stand.
  if (existing && !Object.values(fields).some((value) => value !== undefined)) fields.instructions = existing.prompt;
  return {
    applied: (result, threadId) => {
      const answer = fieldsOf(result), went = answer?.state === "applied" || answer?.state === undefined;
      const id = went ? existing?.id ?? resultId(result) : undefined;
      if (!id) return;
      const refused = set(id);
      if (typeof answer?.messageId === "string") deps.undoFollows(threadId, answer.messageId, id);
      if (answer) answer.summary = [typeof answer.summary === "string" ? answer.summary : "", refused ? `Not all of it was set: ${refused}` : said].filter(Boolean).join("\n");
    },
  };
}
