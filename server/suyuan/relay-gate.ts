// suyuan fork: when a one-way notice may go into a thread someone else opened (server/host/work-thread.ts asks). Only a turn
// a person is behind may do it, from a conversation that may read the target (outside the fence and the bot API), the same
// two conditions upstream sets before a Chief speaks for the person, and a source conversation that is not itself marked as
// outside work: `carry` would otherwise mark the person's thread outside for good. A thread that waits on the person's answer takes
// nothing: the notice would queue behind the card and run once they answered.
import type { TaskRecord } from "../store.ts";

export const WAITS_ON_PERSON = "That thread is waiting on the person's answer, so it takes no message from a teammate now. Leave it to them, or tell them what is waiting.";
export const OWN_THREADS_ONLY = "From this conversation a one-way notice goes only into threads you opened: a routine or webhook started this turn, or this conversation handled outside content. Say in your reply what should be passed on instead.";

export interface RelayGateDeps {
  personBehind(botId: string, threadId: string): boolean;
  /** The conversation carries the permanent outside mark (outsideLineage.handsNoLevel). */
  outside(threadId: string): boolean;
  readableFrom(threadId: string): (other: string) => boolean;
  openPersonCard(threadId: string): unknown;
}

export const relayGate = (deps: RelayGateDeps, fromBotId: string, fromThreadId: string) => (task: TaskRecord): boolean => {
  if (!deps.personBehind(fromBotId, fromThreadId) || deps.outside(fromThreadId)) throw new Error(OWN_THREADS_ONLY);
  if (!deps.readableFrom(fromThreadId)(task.threadId)) return false;
  if (deps.openPersonCard(task.threadId)) throw new Error(WAITS_ON_PERSON);
  return true;
};
