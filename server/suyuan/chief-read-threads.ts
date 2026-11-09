// suyuan fork: a Chief of Staff reads what its teammates are doing. Two internal reads behind the team_threads and
// team_thread_read tools (server/suyuan/chief-read-tools.ts). They write nothing: no read marker, no activity line, no
// turn for the teammate, so looking costs the teammate and the person nothing.
import { chiefLevel } from "../chief-level.ts";
import type { Coordinator } from "../coordinator.ts";
import { canManage } from "../peer-roster.ts";
import { peerProvenanceAuthor } from "../peer-provenance.ts";
import { redactSecretsInText } from "../redact.ts";
import type { BotRecord, Message, Store, TaskRecord } from "../store.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";

export const TEAM_THREADS_PATH = "/api/internal/team-threads";
export const TEAM_THREAD_MESSAGES_PATH = "/api/internal/team-thread-messages";

export const THREADS_DEFAULT = 8;
export const THREADS_MAX = 20;
export const MESSAGES_DEFAULT = 10;
export const MESSAGES_MAX = 30;
/** One message's body, and the whole reply: a long run would otherwise fill the Chief's context. */
export const MESSAGE_CHARS = 1500;
export const REPLY_CHARS = 16000;

export interface TeamThreadRow {
  threadId: string; title: string;
  state: "running" | "waiting-on-you" | "queued" | "idle" | "closed";
  lastActivityAt: number;
}

export interface TeamMessageRow {
  id: string; at: number; speaker: string; kind: string;
  /** A one-line summary for a tool call or card; the body (cut, secrets masked) for a text message. */
  text: string; clipped?: true;
}

export function createChiefReadRoutes(deps: {
  store: Pick<Store, "bot" | "bots" | "tasks" | "taskByThread" | "messagesTail">;
  coordinator: Pick<Coordinator, "awaitingAnswer" | "parkedDirect" | "activeDirect">;
  from: BotRecord;
  fromThreadId: string;
  ownsThread(botId: string, threadId: string): boolean;
  /** The same fence list_threads applies: a thread this turn may not see is not listed or read. */
  shown(threadId: string): boolean;
  threadBusy(botId: string, threadId: string): boolean;
  queuedThreadPosition(botId: string, threadId: string): number | null;
}): RouteHandler {
  const { store, coordinator, from } = deps;

  const stateOf = (bot: BotRecord, task: TaskRecord): TeamThreadRow["state"] => {
    if (task.activity === "waiting-on-you" || coordinator.awaitingAnswer(task.threadId)) return "waiting-on-you";
    if (deps.threadBusy(bot.id, task.threadId)) return "running";
    if (coordinator.parkedDirect(task.threadId)) return "waiting-on-you";
    if (deps.queuedThreadPosition(bot.id, task.threadId) !== null || coordinator.activeDirect(task.threadId)) return "queued";
    return task.closedBy ? "closed" : "idle";
  };

  const clip = (value: unknown, max: number): number => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 1 ? Math.min(Math.trunc(n), max) : 0;
  };

  return async ({ res, path, method, url, json }) => {
    if (method !== "GET" || (path !== TEAM_THREADS_PATH && path !== TEAM_THREAD_MESSAGES_PATH)) return PASS;
    if (!deps.ownsThread(from.id, deps.fromThreadId)) return json(res, 403, { error: "source conversation does not belong to sender" });
    if (!chiefLevel(from)) return json(res, 403, { error: "only a Chief of Staff can read a teammate's conversations" });
    // Not "botId": index.ts reads that query key as the sender and refuses a call that names anyone else.
    const botId = (url.searchParams.get("targetBotId") ?? "").trim().slice(0, 128);
    if (!botId) return json(res, 400, { error: "bot_id is required: a teammate's id from list_bots" });
    if (botId === from.id) return json(res, 400, { error: "that is you: use list_threads or session_search for your own conversations" });
    const target = store.bot(botId);
    // One refusal for a bot that does not exist and one this Chief does not manage, so the id space leaks nothing.
    if (!target || !canManage(from, target)) return json(res, 404, { error: "no teammate you manage has that id: copy it exactly from list_bots" });

    if (path === TEAM_THREADS_PATH) {
      const limit = clip(url.searchParams.get("limit"), THREADS_MAX) || THREADS_DEFAULT;
      const rows: TeamThreadRow[] = store.tasks(target.id)
        .filter((task) => !task.routineRunId && task.archivedAt === undefined && deps.shown(task.threadId))
        .map((task) => ({ threadId: task.threadId, title: redactSecretsInText(task.title), state: stateOf(target, task), lastActivityAt: task.updatedAt ?? task.createdAt }))
        .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
        .slice(0, limit);
      return json(res, 200, { bot: { id: target.id, name: target.name }, threads: rows });
    }

    const threadId = (url.searchParams.get("threadId") ?? "").trim().slice(0, 128);
    const task = threadId ? store.taskByThread(target.id, threadId) : undefined;
    if (!task || !deps.shown(threadId)) return json(res, 404, { error: `no such thread on ${target.name}: call team_threads for the ones you can read` });
    const limit = clip(url.searchParams.get("limit"), MESSAGES_MAX) || MESSAGES_DEFAULT;
    // A page from the tail, not the whole thread, and nothing is loaded for the teammate's next turn.
    const { messages, hasMore } = store.messagesTail(threadId, limit);
    let budget = REPLY_CHARS;
    const rows: TeamMessageRow[] = [];
    for (const message of messages.slice().reverse()) {
      const row = describe(message, target.name);
      if (budget <= 0) break;
      budget -= row.text.length;
      rows.push(row);
    }
    rows.reverse();
    return json(res, 200, {
      bot: { id: target.id, name: target.name }, threadId, title: redactSecretsInText(task.title), state: stateOf(target, task),
      messages: rows, earlier: hasMore || rows.length < messages.length,
    });
  };
}

/** Whose words these are, and either the text (cut, secrets masked: a person's lines are stored as typed) or one line for the rest. */
export function describe(message: Message, botName: string): TeamMessageRow {
  const peer = message.peerAsk?.name ?? (message.text ? peerProvenanceAuthor(message.text) : null);
  const speaker = peer ? `@${peer} (another bot, not the person)` : message.role === "user" ? "the person" : message.from?.name ?? botName;
  const base = { id: message.id, at: message.at, speaker, kind: message.kind };
  // A digest repeats the reply above it, so it reads as one line like the other cards.
  if (message.kind === "text" && message.text) {
    const text = redactSecretsInText(message.text);
    return text.length > MESSAGE_CHARS ? { ...base, text: `${text.slice(0, MESSAGE_CHARS)}…`, clipped: true } : { ...base, text };
  }
  if (message.kind === "activity" && message.tool) {
    const detail = message.tool.summary ? `: ${message.tool.summary.replace(/\s+/g, " ").slice(0, 120)}` : "";
    return { ...base, text: redactSecretsInText(`${message.tool.name}${message.tool.ok === false ? " (failed)" : ""}${detail}`) };
  }
  return { ...base, text: `[${message.kind}${message.text ? `: ${redactSecretsInText(message.text.replace(/\s+/g, " ").slice(0, 120))}` : ""}]` };
}
