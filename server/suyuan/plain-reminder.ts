// suyuan fork: a reminder that needs no AI (shared/suyuan/plain-reminder.ts says how it is marked). The scheduler has
// already opened the run's own conversation when it asks for a turn; here the reminder's text is written there as the
// bot's reply and the run is settled with the two events a real turn ends on, so everything after a run (its line in
// the chat it reports to, the notification, the run's record) happens exactly as it does for a run a model answered.
import { plainText } from "../../shared/suyuan/plain-reminder.ts";
import { newEventId } from "../contracts.ts";
import type { RuntimeEvent } from "../../shared/runtime-events.ts";

type Run = { id: string; botId: string; prompt?: string; threadId?: string; target: string; status: string };

export interface PlainReminderDeps<R extends Run> {
  /** The run working in this conversation. */
  run(threadId: string): R | null;
  /** Writes the bot's closing reply into the run's conversation. */
  say(threadId: string, text: string): void;
  /** Hands the scheduler a runtime event; it answers with the run as it now stands. */
  settle(event: RuntimeEvent): R | null;
  /** The run completed: its reply goes where its reports go. */
  report(run: R): void;
}

/** True when this run was a plain reminder and has been delivered: the caller starts no turn. */
export function deliverPlainReminder<R extends Run>(threadId: string, deps: PlainReminderDeps<R>): boolean {
  const run = deps.run(threadId);
  const text = run?.target === "bot" && run.status === "running" ? plainText(run.prompt) : null;
  if (!run || !text) return false;
  deps.say(threadId, text);
  const event = { eventId: newEventId(), provider: "plain-reminder", threadId, createdAt: new Date().toISOString() };
  deps.settle({ ...event, type: "item.completed", itemType: "assistant_text", text } as RuntimeEvent);
  const settled = deps.settle({ ...event, eventId: newEventId(), type: "turn.completed", ok: true, cost: 0 });
  if (settled?.status === "completed") deps.report(settled);
  return true;
}
