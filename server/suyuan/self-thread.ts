// suyuan fork: a thread a bot opens on itself (start_thread) is work in the runtime like a teammate's. Its result returns
// to the conversation that opened it and resumes it, and that conversation can send it another message later, while it
// runs or after it answered, with coordinate_bots, its own bot id and the thread's id. Upstream refuses a bot as its own
// target in three places, because between two bots that is a loop; this file holds the one narrow exception and the words
// bots read about it.
import { selfThreadRefusal } from "../host/self-threads.ts";

type Place = { botId: string; threadId: string; groupId?: string | undefined };

/** The one exception to "never hand work to an ancestor": a conversation's own turn (a root, nothing handed it this work)
 * hands work to another conversation of the same bot, neither of them a room. Work that came through another bot and
 * back, a thread opened from a thread, and a turn's own conversation all stay refused. */
export function ownOtherThread(parent: { parentId?: string | undefined } & Place | undefined, target: Place): boolean {
  return parent !== undefined && parent.parentId === undefined && parent.botId === target.botId
    && parent.groupId === undefined && target.groupId === undefined && parent.threadId !== target.threadId;
}

/** The same test on runtime rows, whose address sits under `assignee`. */
export function ownOtherThreadRow(
  parent: { parentId?: string | undefined; assignee: { botId: string; destination: { threadId: string; groupId?: string | undefined } } } | undefined,
  target: Place,
): boolean {
  return parent !== undefined && ownOtherThread({ parentId: parent.parentId, botId: parent.assignee.botId,
    threadId: parent.assignee.destination.threadId, groupId: parent.assignee.destination.groupId }, target);
}

export const SELF_NEEDS_THREAD = "To open a separate thread on yourself, use start_thread. To send another message into a thread you opened on yourself, call coordinate_bots with your own bot id and thread set to that thread's id (start_thread returns it; list_threads shows it). Do not retry this call unchanged.";
export const SELF_NO_CONSULT = "consult asks a teammate a question; it cannot go to yourself. Think it through here, or open a thread on yourself with start_thread.";
export const SELF_SAME_THREAD = "That is the thread you are speaking in: do the work here instead of sending it to yourself.";
export const selfNotOpened = (thread: string): string =>
  `"${thread}" is not a thread you opened on yourself: use the thread id start_thread gave you, or one list_threads shows as your own.`;
export const SELF_BRIEF_MAX = 12_000;
export const selfBriefTooLong = (length: number): string =>
  `message is ${length} characters; a thread you open on yourself takes at most ${SELF_BRIEF_MAX}. Put the long material in a file and name its path in the message.`;

/** Why coordinate_bots may not go to the caller itself, or undefined when it may.
 * `opening`: start_thread is opening the thread, and has done its own checks. `answers`: the message answers a question a
 * thread of its own asked. `answeringBack`: a one-way notice to the conversation that opened this thread and asked to hear
 * back. Otherwise only a conversation's own turn may, and only into a thread the bot opened on itself. */
export function selfTargetRefusal(input: {
  opening: boolean; answers: boolean; answeringBack: boolean; consult: boolean; thread: string; botId: string; fromThreadId: string;
  handoff: boolean; requestLine: { peerAsk?: unknown } | undefined;
  /** The bot's own task `thread` names, when it names one. */
  task: { openedBy?: { botId?: string; roomLane?: unknown } } | undefined;
}): string | undefined {
  if (input.opening || input.answers || input.answeringBack) return undefined;
  if (input.consult) return SELF_NO_CONSULT;
  const handed = selfThreadRefusal({ handoff: input.handoff, requestLine: input.requestLine });
  if (handed) return handed;
  if (input.thread === "standing" || input.thread === "new") return SELF_NEEDS_THREAD;
  if (input.thread === input.fromThreadId) return SELF_SAME_THREAD;
  if (!input.task || input.task.openedBy?.botId !== input.botId || input.task.openedBy.roomLane) return selfNotOpened(input.thread);
  return undefined;
}

/** For the envelope a self-opened thread reads: who "@Name" is, and whose words the brief holds. Empty for a teammate. */
export function selfBriefLine(
  a: { requester: { kind: string; botId?: string | undefined }; assignee: { botId: string } },
  names: { requester: string; thread?: string | undefined },
  person: string,
  quoted: (text: string | undefined) => string,
): string {
  if (a.requester.kind !== "bot_turn" || a.requester.botId !== a.assignee.botId) return "";
  const title = quoted(names.thread);
  return `@${quoted(names.requester) || "The requester"} here is you: you opened this thread yourself${title ? `, from your conversation "${title}"` : ", from another conversation of yours"}. The brief below is your own words from there, not ${person}'s. `;
}

/** For the report the opening conversation reads: whose report it is, and how to send that thread another message. */
export function selfReportLine(a: { requester: { kind: string; botId?: string | undefined }; assignee: { botId: string; destination: { threadId: string; groupId?: string | undefined } } }): string | undefined {
  if (a.requester.kind !== "bot_turn" || a.requester.botId !== a.assignee.botId || a.assignee.destination.groupId !== undefined) return undefined;
  const thread = a.assignee.destination.threadId;
  return `This report comes from a thread you opened on yourself [thread id: ${thread}]. To send it another message, call coordinate_bots with bot_ids ["${a.assignee.botId}"] and thread "${thread}".`;
}

/** What start_thread answers for a thread on yourself whose result returns (report "resume"). */
export function selfThreadOpenedText(input: { opened: string; title: string; threadId: string; botId: string; assignmentId: string }): string {
  return `${input.opened} It runs in parallel with this conversation. When it finishes, its result returns to this conversation and resumes you (assignment id: ${input.assignmentId || "unknown"}). To send it another message later, while it still runs or after it answered, call coordinate_bots with bot_ids ["${input.botId}"] and thread "${input.threadId}". Mention it to the person as #${input.title} and finish your turn; do not check or wait for it in this turn.`;
}

/** The `report` parameter start_thread gains. */
export const SELF_THREAD_REPORT_PARAM = {
  type: "string",
  enum: ["resume", "none"],
  description: "resume (default): when the thread finishes, its result returns to this conversation and resumes you. none: the result stays in that thread and nothing comes back.",
} as const;

/** What start_thread hands coordinateBots for a thread on the caller itself: the level and model the thread starts with. */
export interface SelfThreadOpening {
  approvalMode?: "ask" | "full" | undefined;
  modelSelection?: import("../../shared/wire.ts").ModelSelection | undefined;
}

type ArchivedTask = { archivedAt?: number | undefined; openedBy?: { botId?: string; roomLane?: unknown } | undefined };

/** A message sent into a thread its sender opened brings that thread back from the archive (threads bots opened are
 * archived after an hour idle), so the thread rules find it and the person sees it again. Other threads are left alone. */
export function reopenOwnThread(
  store: { taskByThread(botId: string, threadId: string): ArchivedTask | undefined; patchTask(botId: string, threadId: string, patch: { archivedAt?: number | undefined }): unknown },
  botId: string, thread: string, senderId: string,
): boolean {
  if (thread === "standing" || thread === "new") return false;
  const task = store.taskByThread(botId, thread);
  if (!task || task.archivedAt === undefined || task.openedBy?.botId !== senderId || task.openedBy.roomLane) return false;
  store.patchTask(botId, thread, { archivedAt: undefined });
  return true;
}

type Who = { id: string; name: string; color: string };

/** The row a conversation keeps when it opens a thread on its own bot, or sends one another message: upstream's
 * "Opened thread #Title", and "Sent to #Title" rather than the bot's own name. Undefined for a teammate. */
export function ownThreadRow(input: { sender: Who; recipient: Who; threadId: string; title: string | undefined; opening: boolean; inRoom: boolean;
  line: (key: "server.rooms.openedThread" | "server.teammates.sent", vars: Record<string, string>) => string }) {
  if (input.sender.id !== input.recipient.id) return undefined;
  const title = input.title ?? input.sender.name;
  return {
    role: "bot" as const, kind: "activity" as const,
    ...(input.inRoom ? { from: { botId: input.sender.id, name: input.sender.name, color: input.sender.color } } : {}),
    tool: { name: input.opening ? input.line("server.rooms.openedThread", { title }) : input.line("server.teammates.sent", { bot: `#${title}` }), ok: true },
    threadRef: { botId: input.sender.id, threadId: input.threadId, title },
  };
}

/** Whether the turn works on a hand-off, for the rule that only a conversation's own turn opens threads on its bot.
 * Upstream reads any turn the runtime runs as one, which also catches a conversation's own turn resumed with a result:
 * that turn still serves the person's request, and must be able to send its thread another message. A room turn, and a
 * turn whose node is unknown, stay hand-offs. */
export function handedTurn(nodeId: string | undefined, node: (id: string) => { parentId?: string | undefined; groupId?: string | undefined } | undefined): boolean {
  if (!nodeId) return false;
  const running = node(nodeId);
  return !running || running.parentId !== undefined || running.groupId !== undefined;
}
