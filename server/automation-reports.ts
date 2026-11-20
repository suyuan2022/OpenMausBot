// A bot's automations report into the chat they belong to. A run still works in its own hidden conversation with a
// fresh session; when it ends with something to say, its last reply lands in that chat as one bot message named after
// the automation, and a run with nothing to tell writes nothing. A card a run waits on is copied there, and answering
// the copy answers the run. Nothing is written into a chat while a turn runs or settles in it: a line waits for the
// next flush, which the server runs whenever it releases what was queued behind a turn, ahead of that queue. A routine
// that delivers to the brief posts no line: its answer goes to the brief, which reads it as a small JSON result.
import { liveCardKind } from "../shared/live-approval.ts";
import type { AutomationLine } from "../shared/routine-run.ts";
import { signInWaits } from "../shared/sign-in-request.ts";
import { intlLocale } from "./language.ts";
import { needsInputQuestion } from "./runtime-coordinator.ts";
import type { RoutineManager, RoutineRun } from "./routines.ts";
import { serverLine } from "./server-lines.ts";
import type { BotRecord, Message, Store } from "./store.ts";
import { hostTimeZone } from "./turn-clock.ts";
import { AUTHORITY, fromNote, routineWho } from "./provenance-label.ts";
import {
  collectRecoverableRoutineTurns, extractTurnReport, findPostedRunFailure, findPostedRunReply,
  hasPostedRunReply, runReportFailureKey, runReportReplyKey, shouldDeliverAutomationTurn, type TurnAttachment,
} from "./suyuan/automation-report-turns.ts";

const QUIET = /^[\s*_`"'.!-]*nothing new[\s*_`"'.!-]*$/i;
const NEEDS_INPUT = /^\s*needs input:\s*/i;

export type RunReply = { quiet: true } | { quiet: false; text: string; question?: string };

/** What a run's last reply says to the person. Its last line alone being NOTHING NEW keeps the run quiet. */
export function readRunReply(text: string, attached = false): RunReply {
  const lines = text.trim().split(/\r?\n/);
  if (QUIET.test(lines.at(-1) ?? "") || (!text.trim() && !attached)) return { quiet: true };
  const question = needsInputQuestion(text);
  if (question === undefined) return { quiet: false, text: text.trim() };
  const at = lines.findLastIndex((line) => NEEDS_INPUT.test(line));
  return { quiet: false, text: [...lines.slice(0, at), lines[at]!.replace(NEEDS_INPUT, ""), ...lines.slice(at + 1)].join("\n").trim(), question };
}

function inHostZone(at: number, locale: string, options: Intl.DateTimeFormatOptions): string {
  const format = (timeZone: string) => new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(at);
  try { return format(hostTimeZone()); } catch { return format("UTC"); }
}

const localTime = (at: number) =>
  inHostZone(at, "en-CA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).replace(",", "");

// ICU 72+ puts a narrow no-break space (U+202F) before AM/PM.
const clockTime = (at: number, language?: string) =>
  inHostZone(at, intlLocale(language), { hour: "numeric", minute: "2-digit", timeZoneName: "short" }).replace(/\s/g, " ");

/** The line a run with nothing new posts when the automation's line before it in the chat said a run failed, in the
 * language of the chat's person. */
export function recoveredText(name: string, at: number, language?: string): string {
  return serverLine(language, "server.runs.recovered", { name, time: clockTime(at, language) });
}

/** How the chat's own session reads an automation's line: as its own report, named and dated. */
export function automationContextText(line: AutomationLine, at: number, text: string): string {
  const what = line.partial ? "was partly done" : line.failed ? "could not finish" : line.needsYou ? "asked" : line.recovered ? "recovered" : "reported";
  return `${fromNote(routineWho(line.name), `run, ${what} at ${localTime(at)}`, AUTHORITY.info)}\n${text}`;
}

/** A sign-in, connection or credential card still waiting on the person, in plain words in their language; null once
 * it is settled. */
export function waitingCardText(message: Pick<Message, "kind" | "signIn" | "connector" | "secret">, language?: string): string | null {
  const { signIn, connector, secret } = message;
  if (message.kind === "signin" && signIn && signInWaits(signIn) && !signIn.resumed && !signIn.stopped) {
    const reason = signIn.reason?.trim();
    return reason ? serverLine(language, "server.connect.signInWhy", { site: signIn.site, reason: /[.!?]$/.test(reason) ? reason : `${reason}.` })
      : serverLine(language, "server.connect.signIn", { site: signIn.site });
  }
  if (message.kind === "connector" && connector && connector.status !== "connected" && !connector.dismissed && !connector.resumed && !connector.stopped) {
    return serverLine(language, "server.connect.app", { app: connector.label });
  }
  if (message.kind === "secret" && secret && !secret.provided && !secret.dismissed && !secret.superseded && !secret.resumed && !secret.stopped) {
    return serverLine(language, "server.connect.secret", { label: secret.label });
  }
  return null;
}

/** The newest run's lines of each automation: whatever else is dropped for room, the chat's session always gets these. */
export function newestAutomationLines(messages: readonly Pick<Message, "id" | "automation">[]): Set<string> {
  const newestRun = new Map<string, string>();
  for (const message of messages) if (message.automation) newestRun.set(message.automation.routineId, message.automation.runId);
  const kept = new Set<string>();
  for (const message of messages) {
    if (message.automation && newestRun.get(message.automation.routineId) === message.automation.runId) kept.add(message.id);
  }
  return kept;
}

type Waiting =
  | { kind: "reply"; run: RoutineRun; turnId?: string; messageId?: string; attachments?: TurnAttachment[]; intermediate?: boolean }
  | { kind: "failure"; run: RoutineRun; detail: string }
  | { kind: "card"; run: RoutineRun; threadId: string; messageId: string };

export interface AutomationReportDeps {
  store: Pick<Store, "activePath" | "appendMessage" | "bot" | "botByThread" | "messagesFor" | "onChange" | "patchMessage" | "patchTask" | "taskByThread">;
  routines(): Pick<RoutineManager, "listRuns" | "noteReport" | "runForThread"> | null;
  /** A turn runs or settles in this conversation. */
  busy(botId: string, threadId: string): boolean;
  /** After a line this conversation's session did not write: it reaches the next turn. The chat is marked unread here. */
  wrote(bot: BotRecord, threadId: string): void;
  notify(kind: "done" | "question", bot: BotRecord, threadId: string, detail: string): void;
  /** A run that delivers to the brief completed: its answer is the brief's to read. */
  brief?(run: RoutineRun, turnId?: string): void;
  /** The language a line in this conversation is written in (server/server-lines.ts); absent, English. */
  threadLanguage?(threadId: string): string | undefined;
}

export function createAutomationReports(deps: AutomationReportDeps) {
  const { store } = deps;
  const waiting = new Map<string, Waiting>();
  let resumed = false;
  let flushing = false;

  const destination = (run: RoutineRun): { bot: BotRecord; threadId: string } | null => {
    const bot = run.resultsThreadId && run.resultsThreadId !== run.threadId ? store.bot(run.botId) : undefined;
    const task = bot && !bot.hidden ? store.taskByThread(bot.id, run.resultsThreadId!) : undefined;
    return bot && task && !task.routineRunId ? { bot, threadId: task.threadId } : null;
  };

  const lineOf = (run: RoutineRun, extra: Pick<AutomationLine, "needsYou" | "failed" | "partial" | "recovered" | "copyOf" | "turnId">): AutomationLine => ({
    routineId: run.routineId, runId: run.id, name: run.routineName, trigger: run.eventSource ?? run.triggerSource ?? (run.manual ? "manual" : "schedule"),
    executionThreadId: run.threadId!, scheduledFor: run.scheduledFor, ...extra,
  });

  const hasQueuedReply = (runId: string, excludeKey?: string): boolean => {
    for (const [key, entry] of waiting) {
      if (key !== excludeKey && entry.kind === "reply" && entry.run.id === runId) return true;
    }
    return false;
  };

  /** The automation's line before this run's in the chat, written or still waiting ahead of it, says a run failed. */
  const lastSaidFailed = (run: RoutineRun, threadId: string, currentKey: string): boolean => {
    let queued: Waiting | undefined;
    for (const [key, line] of waiting) {
      if (key === currentKey) break;
      if (line.kind !== "card" && line.run.routineId === run.routineId && destination(line.run)?.threadId === threadId) queued = line;
    }
    if (queued) return queued.kind === "failure";
    const newest = store.messagesFor(threadId).findLast((message) => message.automation?.routineId === run.routineId && !message.automation.copyOf);
    return newest?.automation?.failed === true;
  };

  const copyOf = (run: RoutineRun, threadId: string, originalId: string) =>
    store.messagesFor(threadId).find((message) => message.automation?.runId === run.id && message.automation.copyOf === originalId);

  /** An option card is copied whole and answered through its request; any other card the run waits on is named. */
  const writeCopy = (line: Extract<Waiting, { kind: "card" }>, target: { bot: BotRecord; threadId: string }) => {
    const original = store.messagesFor(line.threadId).find((message) => message.id === line.messageId);
    const named = original ? waitingCardText(original, deps.threadLanguage?.(target.threadId)) : null;
    if (!original || (!named && !liveCardKind(original.card))) return;
    const automation = lineOf(line.run, { needsYou: true, copyOf: original.id });
    store.appendMessage(target.threadId, named ? { role: "bot", kind: "text", text: named, automation } : { role: "bot", kind: "options", card: { ...original.card! }, automation });
    if (named) deps.wrote(target.bot, target.threadId);
    store.patchTask(target.bot.id, target.threadId, { unread: true });
  };

  /** False while the chat it goes to is busy. */
  const write = (key: string, line: Waiting): boolean => {
    const { run } = line;
    const target = destination(run);
    if (!target) {
      if (line.kind !== "card" && !(line.kind === "reply" && line.intermediate)) deps.routines()?.noteReport(run.id, undefined);
      return true;
    }
    if (deps.busy(target.bot.id, target.threadId)) return false;
    if (line.kind === "card") {
      writeCopy(line, target);
      return true;
    }
    const targetMessages = store.messagesFor(target.threadId);
    if (line.kind === "failure") {
      const written = findPostedRunFailure(targetMessages, run.id);
      if (written) {
        deps.routines()?.noteReport(run.id, { state: "posted", threadId: target.threadId, messageId: written.id });
        return true;
      }
      const language = deps.threadLanguage?.(target.threadId);
      const text = line.detail
        ? serverLine(language, run.partial ? "server.runs.partlyDoneWhy" : "server.runs.didNotFinishWhy", { detail: line.detail })
        : serverLine(language, "server.runs.didNotFinish");
      const posted = store.appendMessage(target.threadId, {
        role: "bot", kind: "text", text,
        automation: lineOf(run, { failed: true, ...(run.partial ? { partial: true as const } : {}) }),
      });
      deps.routines()?.noteReport(run.id, { state: "posted", threadId: target.threadId, messageId: posted.id });
      deps.wrote(target.bot, target.threadId);
      store.patchTask(target.bot.id, target.threadId, { unread: true });
      return true;
    }

    const extracted = extractTurnReport(run.threadId ? store.activePath(run.threadId) : [], line.turnId, line.messageId);
    const source = extracted.source;
    const attachments = line.attachments ?? extracted.attachments;
    const turnKey = line.turnId ?? source?.id;
    const written = findPostedRunReply(targetMessages, run.id, turnKey);
    if (written) {
      deps.routines()?.noteReport(run.id, { state: "posted", threadId: target.threadId, messageId: written.id });
      return true;
    }
    const language = deps.threadLanguage?.(target.threadId);
    const said: RunReply = readRunReply(source?.text ?? "", attachments.length > 0);
    const priorPosted = hasPostedRunReply(targetMessages, run.id);
    if (said.quiet && (line.intermediate || priorPosted || hasQueuedReply(run.id, key))) return true;
    const recovered = said.quiet && lastSaidFailed(run, target.threadId, key);
    if (said.quiet && !recovered) {
      deps.routines()?.noteReport(run.id, { state: "quiet" });
      return true;
    }
    const reply: Extract<RunReply, { quiet: false }> = said.quiet ? { quiet: false, text: recoveredText(run.routineName, run.finishedAt ?? Date.now(), language) } : said;
    const stampTurn = Boolean((line.intermediate || priorPosted) && turnKey);
    const posted = store.appendMessage(target.threadId, {
      role: "bot", kind: "text", text: reply.text,
      ...(attachments.length && !recovered ? { attachments } : {}),
      automation: lineOf(run, {
        ...(recovered ? { recovered: true } : reply.question ? { needsYou: true } : {}),
        ...(stampTurn ? { turnId: turnKey } : {}),
      }),
    });
    deps.routines()?.noteReport(run.id, { state: "posted", threadId: target.threadId, messageId: posted.id });
    deps.wrote(target.bot, target.threadId);
    store.patchTask(target.bot.id, target.threadId, { unread: true });
    if (!recovered) {
      const summary = reply.question ?? (reply.text || (attachments[0] && "name" in attachments[0] && attachments[0].name) || "Attachment");
      deps.notify(reply.question ? "question" : "done", target.bot, target.threadId, `${run.routineName}: ${summary}`);
    }
    return true;
  };

  const flush = () => {
    const manager = deps.routines();
    if (flushing || !manager) return;
    flushing = true;
    try {
      if (!resumed) {
        resumed = true;
        for (const run of manager.listRuns().reverse()) {
          if (run.report?.state !== "pending") continue;
          if (run.status === "failed") {
            const failKey = runReportFailureKey(run.id);
            if (!waiting.has(failKey)) waiting.set(failKey, { kind: "failure", run, detail: run.error ?? "" });
            continue;
          }
          if (hasQueuedReply(run.id)) continue;
          const turns = run.threadId ? collectRecoverableRoutineTurns(store.activePath(run.threadId)) : [];
          if (turns.length === 0) {
            waiting.set(runReportReplyKey(run.id), { kind: "reply", run, ...(run.status === "waiting" ? { intermediate: true } : {}) });
            continue;
          }
          for (let i = 0; i < turns.length; i += 1) {
            const turn = turns[i]!;
            const turnKey = turn.turnId ?? turn.messageId;
            const key = runReportReplyKey(run.id, turnKey);
            if (waiting.has(key)) continue;
            const intermediate = i < turns.length - 1 || run.status === "waiting";
            waiting.set(key, {
              kind: "reply", run,
              ...(turn.turnId ? { turnId: turn.turnId } : {}),
              ...(turn.messageId ? { messageId: turn.messageId } : {}),
              ...(intermediate ? { intermediate: true } : {}),
            });
          }
        }
      }
      for (const [key, line] of waiting) if (write(key, line)) waiting.delete(key);
    } finally {
      flushing = false;
    }
  };

  const hold = (key: string, line: Waiting) => {
    if (line.kind !== "card") deps.routines()?.noteReport(line.run.id, { state: "pending" });
    waiting.set(key, line);
    flush();
  };

  store.onChange((change) => {
    if (change.type !== "message" && change.type !== "message.patch") return;
    const { message } = change;
    const option = message.kind === "options" && Boolean(message.card?.requestId);
    if (message.automation || (!option && message.kind !== "signin" && message.kind !== "connector" && message.kind !== "secret")) return;
    const run = deps.routines()?.runForThread(change.threadId);
    const target = run?.target === "bot" && store.taskByThread(run.botId, change.threadId)?.routineRunId === run.id ? destination(run) : null;
    if (!run || !target) return;
    if (change.type === "message") {
      if (option ? !message.card!.autoApplied : waitingCardText(message)) {
        hold(`card:${message.id}`, { kind: "card", run, threadId: change.threadId, messageId: message.id });
      }
      return;
    }
    const copy = copyOf(run, target.threadId, message.id);
    if (!copy) return;
    if (option && JSON.stringify(copy.card) !== JSON.stringify(message.card)) store.patchMessage(target.threadId, copy.id, { card: { ...message.card! } });
    if (!option && copy.automation?.needsYou && !waitingCardText(message)) {
      const { needsYou: _settled, ...line } = copy.automation;
      store.patchMessage(target.threadId, copy.id, { automation: line });
    }
  });

  return {
    flush,
    /** A run's turn ended: each non-quiet turn delivers its reply and turn attachments to the chat it reports to. */
    runSettled(run: RoutineRun, turnId?: string): void {
      if (!shouldDeliverAutomationTurn(run)) return;
      if (run.deliver === "brief") {
        if (run.status === "completed") deps.brief?.(run, turnId);
        return;
      }
      const intermediate = run.status === "waiting";
      const { source, attachments } = extractTurnReport(store.activePath(run.threadId!), turnId);
      const reply = readRunReply(source?.text ?? "", attachments.length > 0);
      const bot = store.bot(run.botId);
      const target = destination(run);
      const turnKey = turnId ?? source?.id;
      const key = runReportReplyKey(run.id, turnKey);
      if (target) {
        if (!reply.quiet) {
          hold(key, {
            kind: "reply", run,
            ...(turnId ? { turnId } : {}),
            ...(source ? { messageId: source.id } : {}),
            attachments,
            ...(intermediate ? { intermediate: true } : {}),
          });
        } else if (!intermediate) {
          const prior = hasPostedRunReply(store.messagesFor(target.threadId), run.id) || hasQueuedReply(run.id, key);
          if (prior) return;
          if (lastSaidFailed(run, target.threadId, key)) {
            hold(key, { kind: "reply", run, ...(turnId ? { turnId } : {}), ...(source ? { messageId: source.id } : {}), attachments });
          } else {
            deps.routines()?.noteReport(run.id, { state: "quiet" });
          }
        }
      } else if (reply.quiet) {
        if (!intermediate) deps.routines()?.noteReport(run.id, { state: "quiet" });
      } else if (bot) {
        deps.notify("done", bot, run.threadId!, reply.text || (attachments[0] && "name" in attachments[0] && attachments[0].name) || "Attachment");
      }
    },
    /** A run failed in a way the person is told about: one line says so where its reports go. */
    runFailed(run: RoutineRun, detail: string): void {
      if (run.target === "bot" && run.status === "failed" && run.deliver !== "brief" && run.threadId && destination(run)) {
        hold(runReportFailureKey(run.id), { kind: "failure", run, detail });
      }
    },
    /** This run's result, questions and failure come to its bot's chat as lines of their own, or through the brief.
     * A missed run, or one that failed before it had a conversation, has no line to say so, and keeps its card,
     * unless it delivers to the brief, which lists it as missed. */
    speaksFor(run: RoutineRun): boolean {
      return run.target === "bot" && destination(run) !== null
        && (run.deliver === "brief" || (run.status !== "missed" && (run.status !== "failed" || Boolean(run.threadId))));
    },
    /** This conversation is a run's own, and its replies reach the chat the run reports to. */
    reportsElsewhere(threadId: string): boolean {
      const run = deps.routines()?.runForThread(threadId);
      return run?.target === "bot" && run.deliver !== "brief" && destination(run) !== null;
    },
    /** Where an answer to this card goes: a copy of a run's card answers it in the run's own conversation. */
    answeredIn(threadId: string, requestId: string): string {
      const owner = store.botByThread(threadId);
      const execution = owner && store.messagesFor(threadId).find((message) => message.card?.requestId === requestId && message.automation)?.automation?.executionThreadId;
      return owner && execution && store.taskByThread(owner.id, execution) ? execution : threadId;
    },
  };
}

export type AutomationReports = ReturnType<typeof createAutomationReports>;
