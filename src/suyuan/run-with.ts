// suyuan fork: what a scheduled automation runs with, as the Automations page's form reads and saves it. "none" is a
// reminder that needs no AI: its text is posted as it is (shared/suyuan/plain-reminder.ts keeps the mark in the
// instructions). "haiku" and "sonnet" are the routine's own model, upstream's Routine.modelSelection, which the server
// already checks and saves. The trigger tool's run_with means the same (server/suyuan/run-with.ts).
// A routine that runs a command first (shared/suyuan/check-first.ts) keeps that command through an edit here: the form
// shows and saves what comes after it.
import { afterCheck, checkFirst, withCheck } from "../../shared/suyuan/check-first";
import { asPlain, plainText, withoutPlainMark } from "../../shared/suyuan/plain-reminder";

export type RunWithChoice = "bot" | "haiku" | "sonnet" | "none";
type Selection = { instanceId: string; model: string };
type Engine = { instanceId: string; models?: { options?: ReadonlyArray<{ id: string }> } };

export function runWithOf(routine: { prompt: string; modelSelection?: { model: string } } | undefined | null): RunWithChoice {
  if (!routine) return "bot";
  if (plainText(afterCheck(routine.prompt)) !== null) return "none";
  const model = routine.modelSelection?.model.toLowerCase() ?? "";
  return model.includes("haiku") ? "haiku" : model.includes("sonnet") ? "sonnet" : "bot";
}

/** The newest model of this kind the bot's engine offers. */
export function modelFor(choice: RunWithChoice, engine: Engine | undefined): Selection | undefined {
  const model = choice === "haiku" || choice === "sonnet" ? engine?.models?.options?.find((option) => option.id.toLowerCase().includes(choice)) : undefined;
  return engine && model ? { instanceId: engine.instanceId, model: model.id } : undefined;
}

/** What the form's text box shows of a routine's instructions: neither mark. */
export const shownText = (prompt: string): string => withoutPlainMark(afterCheck(prompt));

/** The command this routine runs first, if it has one. */
export const commandOf = (routine: { prompt: string } | undefined | null): string | undefined => checkFirst(routine?.prompt)?.command;

/** The two fields of a routine this choice decides. A choice whose model the engine lacks leaves the model as it is;
 * `was`, the instructions before the edit, keeps their command. */
export function runWithFields(choice: RunWithChoice, text: string, engine: Engine | undefined, was?: string): { prompt: string; modelSelection?: Selection | null } {
  const prompt = withCheck(checkFirst(was)?.command, choice === "none" ? asPlain(shownText(text)) : shownText(text));
  if (choice === "none" || choice === "bot") return { prompt, modelSelection: null };
  const selection = modelFor(choice, engine);
  return selection ? { prompt, modelSelection: selection } : { prompt };
}
