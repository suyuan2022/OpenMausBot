// suyuan fork: automation runs that span multiple turns (handing work to a teammate and resuming) or call attach_file
// used to lose earlier turns' replies and every attach_file attachment when reporting into the main chat.
// Upstream only reported once the whole run completed, reading only the last turn's text message and only attachments
// stored directly on that message (while attach_file appends a separate empty-text message with no turnId).
// Here each settled routine turn (waiting on teammates or completed) delivers its own non-quiet reply along with all
// attachments produced in that turn, while quiet turns (NOTHING NEW) still drop their attachments and never erase an
// earlier turn's report.
import { failedTurnCause } from "../../shared/failed-turn.ts";
import { routinePrompt } from "../routine-execution.ts";
import type { RoutineRun } from "../routines.ts";
import type { Message } from "../store.ts";

export type TurnAttachment = NonNullable<Message["attachments"]>[number];

const RETRY_NOTE_PREFIX = "[OpenMausBot: this run's first start ";
const isBotText = (message: Message): boolean => message.role === "bot" && message.kind === "text";
const turnOfLine = (message: Message): string | undefined => message.turnId ?? message.sentInTurn;
const deliveredAttachment = (file: TurnAttachment): boolean => file.kind !== "image" || !file.fromTool;
const isTurnBoundary = (message: Message): boolean =>
  message.role === "user" || message.kind === "digest" || Boolean(message.roomRequest);
const isFailedTurnActivity = (message: Message): boolean =>
  message.kind === "activity" && message.tool?.ok === false && failedTurnCause(message.tool.name) !== null;
const isRoutineExecutionPrompt = (text: string | undefined): boolean =>
  Boolean(text && (routinePrompt(text) || text.includes(RETRY_NOTE_PREFIX)));

/** Whether a routine turn settling in this state should deliver its reply to the chat it reports to.
 * A run waiting on a permission/question card (`run.asked`) is paused mid-turn, not at a turn end; a run waiting
 * on handed-out work (`!run.asked`) has finished a turn of its own. */
export function shouldDeliverAutomationTurn(
  run: Pick<RoutineRun, "target" | "status" | "threadId" | "asked">,
): boolean {
  return run.target === "bot" && Boolean(run.threadId) && (run.status === "completed" || (run.status === "waiting" && !run.asked));
}

/** Unique queue key per run turn so two turns waiting on a busy main chat do not overwrite each other. */
export function runReportReplyKey(runId: string, turnKey?: string): string {
  return turnKey ? `reply:${runId}:${turnKey}` : `reply:${runId}`;
}

export function runReportFailureKey(runId: string): string {
  return `failure:${runId}`;
}

/** Deduplicate delivered attachments by path while preserving order (skipping tool-returned images). */
function collectAttachments(slice: readonly Message[]): TurnAttachment[] {
  const seen = new Set<string>();
  const out: TurnAttachment[] = [];
  for (const message of slice) {
    if (!isBotText(message) || !message.attachments?.length) continue;
    for (const attachment of message.attachments) {
      if (!deliveredAttachment(attachment) || seen.has(attachment.path)) continue;
      seen.add(attachment.path);
      out.push(attachment);
    }
  }
  return out;
}

/** Slice a run thread's active path down to one turn's messages, preserving sentInTurn rows across steered or goal lines
 * and adjacent unstamped attach_file rows within the same turn, without crossing into an earlier or later turn. */
function sliceTurn(path: readonly Message[], turnId?: string, messageId?: string): readonly Message[] {
  const explicit = messageId ? path.find((message) => message.id === messageId) : undefined;
  const effectiveTurnId = turnId ?? (explicit ? turnOfLine(explicit) : undefined);

  if (effectiveTurnId) {
    const matched: number[] = [];
    for (let i = 0; i < path.length; i += 1) {
      const m = path[i]!;
      if (m.role !== "user" && turnOfLine(m) === effectiveTurnId) matched.push(i);
    }
    if (matched.length > 0) {
      const picked = new Set<number>(matched);
      for (const idx of matched) {
        for (let k = idx - 1; k >= 0; k -= 1) {
          const prev = path[k]!;
          if (isTurnBoundary(prev) || prev.turnTerminal || turnOfLine(prev) !== undefined) break;
          picked.add(k);
        }
      }
      let end = matched.at(-1)!;
      while (end + 1 < path.length) {
        const next = path[end + 1]!;
        if (path[end]!.kind === "digest" || path[end]!.turnTerminal || isTurnBoundary(next) || turnOfLine(next) !== undefined) break;
        end += 1;
        picked.add(end);
      }
      return path.filter((_, i) => picked.has(i));
    }
    // Turn emitted no turnId/sentInTurn-stamped rows: take only trailing unstamped bot rows.
    let start = path.length;
    while (start > 0) {
      const prev = path[start - 1]!;
      if (isTurnBoundary(prev) || prev.turnTerminal || turnOfLine(prev) !== undefined) break;
      start -= 1;
    }
    return path.slice(start);
  }

  if (explicit) {
    // Legacy unstamped reply (no turnId or sentInTurn): keep only its own message so earlier unowned lines don't leak in.
    return [explicit];
  }

  // Fallback with neither turnId nor messageId: pick the latest terminal / sentInTurn line (or latest bot text).
  const last = path.findLast((message) => isBotText(message) && (message.turnTerminal || message.sentInTurn !== undefined))
    ?? path.findLast(isBotText);
  if (!last) return [];
  const target = last.sentInTurn
    ? (path.findLast((message) => isBotText(message) && message.turnId === last.sentInTurn) ?? last)
    : last;
  return sliceTurn(path, turnOfLine(target), target.id);
}

/** Extract the final reply message and every delivered attachment produced during one routine turn. */
export function extractTurnReport(
  path: readonly Message[],
  turnId?: string,
  messageId?: string,
): { source: Message | undefined; attachments: TurnAttachment[] } {
  const slice = sliceTurn(path, turnId, messageId);
  const explicit = messageId ? path.find((message) => message.id === messageId) : undefined;
  const effectiveTurnId = turnId ?? (explicit ? turnOfLine(explicit) : undefined);

  let source: Message | undefined = explicit;
  if (!source) {
    if (effectiveTurnId) {
      source = slice.findLast((message) => isBotText(message) && message.turnId === effectiveTurnId && message.turnTerminal)
        ?? slice.findLast((message) => isBotText(message) && message.turnId === effectiveTurnId)
        ?? slice.findLast((message) => isBotText(message) && Boolean(message.attachments?.length));
    } else {
      source = slice.findLast((message) => isBotText(message) && message.turnTerminal)
        ?? slice.findLast((message) => isBotText(message) && Boolean(message.text?.trim()))
        ?? slice.findLast(isBotText);
    }
  }

  const attachments = collectAttachments(slice);
  if (source?.attachments?.length) {
    const seen = new Set(attachments.map((attachment) => attachment.path));
    for (const attachment of source.attachments) {
      if (deliveredAttachment(attachment) && !seen.has(attachment.path)) {
        seen.add(attachment.path);
        attachments.push(attachment);
      }
    }
  }
  return { source, attachments };
}

/** Identify routine turns in a run's transcript for restart recovery: skips side turns started by a person messaging
 * inside the run's hidden conversation, recognizes automatic routine retry prompts, and includes attach_file-only turns. */
export function collectRecoverableRoutineTurns(
  path: readonly Message[],
  options: { failedRun?: boolean } = {},
): Array<{ turnId?: string; messageId?: string }> {
  const personIndices = new Set<number>();
  const personTurnIds = new Set<string>();
  let sawPrompt = false;
  let sawBotBeforePrompt = false;
  let inPersonTurn = false;
  let activePersonTurnId: string | undefined;

  for (let i = 0; i < path.length; i += 1) {
    const message = path[i]!;
    if (message.role === "bot") sawBotBeforePrompt = true;
    if (message.role === "user") {
      if ((!sawPrompt && !sawBotBeforePrompt) || isRoutineExecutionPrompt(message.text)) {
        sawPrompt = true;
        inPersonTurn = false;
        activePersonTurnId = undefined;
      } else {
        sawPrompt = true;
        inPersonTurn = true;
        activePersonTurnId = undefined;
      }
      continue;
    }
    if (message.kind === "digest" || Boolean(message.roomRequest)) {
      inPersonTurn = false;
      activePersonTurnId = undefined;
      continue;
    }
    if (!inPersonTurn) continue;
    const msgTurn = turnOfLine(message);
    if (msgTurn) {
      if (activePersonTurnId && msgTurn !== activePersonTurnId) {
        inPersonTurn = false;
        activePersonTurnId = undefined;
        continue;
      }
      activePersonTurnId = msgTurn;
      personTurnIds.add(msgTurn);
    }
    personIndices.add(i);
  }

  const collected: Array<{ index: number; turnId?: string; messageId?: string }> = [];
  const seenTurnIds = new Set<string>();
  const covered = new Set<number>();
  const indexById = new Map(path.map((message, index) => [message.id, index]));

  const failedTurnIds = new Set<string>();
  for (const message of path) {
    const msgTurn = turnOfLine(message);
    if (msgTurn && (message.turnSucceeded === false || isFailedTurnActivity(message))) {
      failedTurnIds.add(msgTurn);
    }
  }

  for (let i = 0; i < path.length; i += 1) {
    const message = path[i]!;
    if (!isBotText(message) || !message.turnTerminal) continue;
    const msgTurn = turnOfLine(message);
    if (personIndices.has(i) || (msgTurn && personTurnIds.has(msgTurn))) continue;
    for (const item of sliceTurn(path, msgTurn, message.id)) {
      const idx = indexById.get(item.id);
      if (idx !== undefined) covered.add(idx);
    }
    if (message.turnSucceeded === false || (msgTurn && failedTurnIds.has(msgTurn))) continue;
    if (msgTurn) {
      if (seenTurnIds.has(msgTurn)) continue;
      seenTurnIds.add(msgTurn);
    }
    collected.push({ index: i, ...(msgTurn ? { turnId: msgTurn } : {}), messageId: message.id });
  }

  // Recover attach_file-only turns that emitted no turnTerminal text row.
  for (let i = 0; i < path.length; i += 1) {
    const message = path[i]!;
    const initialTurn = turnOfLine(message);
    if (covered.has(i) || personIndices.has(i) || (initialTurn && personTurnIds.has(initialTurn))) continue;
    if (!isBotText(message) || !message.attachments?.some(deliveredAttachment) || message.turnSucceeded === false) continue;

    let segTurnId = initialTurn;
    let segStart = i;
    while (segStart > 0) {
      const prevIdx = segStart - 1;
      const prev = path[prevIdx]!;
      const prevTurn = turnOfLine(prev);
      if (covered.has(prevIdx) || personIndices.has(prevIdx) || isTurnBoundary(prev) || prev.turnTerminal) break;
      if (prevTurn !== undefined) {
        if (personTurnIds.has(prevTurn) || (segTurnId !== undefined && prevTurn !== segTurnId)) break;
        segTurnId = prevTurn;
      }
      segStart = prevIdx;
    }
    let segEnd = i;
    while (segEnd + 1 < path.length) {
      const nextIdx = segEnd + 1;
      const next = path[nextIdx]!;
      const nextTurn = turnOfLine(next);
      if (covered.has(nextIdx) || personIndices.has(nextIdx) || isTurnBoundary(next) || next.turnTerminal) break;
      if (nextTurn !== undefined) {
        if (personTurnIds.has(nextTurn) || (segTurnId !== undefined && nextTurn !== segTurnId)) break;
        segTurnId = nextTurn;
      }
      segEnd = nextIdx;
    }

    let failedSegment = false;
    let lastAttachIdx = i;
    for (let j = segStart; j <= segEnd; j += 1) {
      covered.add(j);
      const item = path[j]!;
      if (item.turnSucceeded === false || isFailedTurnActivity(item)) failedSegment = true;
      if (isBotText(item) && item.attachments?.some(deliveredAttachment)) lastAttachIdx = j;
    }
    if (failedSegment || (segTurnId !== undefined && failedTurnIds.has(segTurnId))) continue;
    const hasLaterTurn = path.slice(segEnd + 1).some((item) =>
      (isTurnBoundary(item) && !(item.kind === "digest" && turnOfLine(item) !== undefined && turnOfLine(item) === segTurnId))
      || (Boolean(item.turnTerminal) && item.turnSucceeded !== false),
    );
    if (options.failedRun && !hasLaterTurn) continue;
    if (segTurnId) {
      if (seenTurnIds.has(segTurnId)) continue;
      seenTurnIds.add(segTurnId);
    }

    collected.push({
      index: lastAttachIdx,
      ...(segTurnId ? { turnId: segTurnId } : {}),
      messageId: path[lastAttachIdx]!.id,
    });
  }

  if (collected.length > 0) {
    collected.sort((a, b) => a.index - b.index);
    const hasRoutineEnvelope = path.some((m) => m.kind === "digest" || (m.role === "user" && isRoutineExecutionPrompt(m.text)));
    const selected = hasRoutineEnvelope ? collected : collected.slice(-1);
    return selected.map(({ turnId, messageId }) => ({ ...(turnId ? { turnId } : {}), ...(messageId ? { messageId } : {}) }));
  }

  if (options.failedRun) return [];

  // Legacy / test fixtures without turnTerminal: fall back to the latest non-person, non-failed bot text.
  const latest = path.findLast((message, index) => {
    const msgTurn = turnOfLine(message);
    return isBotText(message) && !personIndices.has(index) && !(msgTurn && personTurnIds.has(msgTurn)) && message.turnSucceeded !== false;
  });
  const latestTurn = latest ? turnOfLine(latest) : undefined;
  return latest ? [{ ...(latestTurn ? { turnId: latestTurn } : {}), messageId: latest.id }] : [];
}

/** Whether a run has already posted a reply (or legacy run card) for this turn into the destination chat. */
export function findPostedRunReply(
  messages: readonly Message[],
  runId: string,
  turnKey?: string,
): Message | undefined {
  const legacyCard = messages.find((message) => message.routineRun?.runId === runId);
  if (legacyCard) return legacyCard;
  return messages.find((message) => {
    if (message.automation?.runId !== runId || message.kind !== "text" || message.automation.copyOf || message.automation.failed) return false;
    // A single-turn completion without turnId covers the whole run; a multi-turn line matches only its own turn.
    if (!message.automation.turnId) return true;
    return turnKey !== undefined && message.automation.turnId === turnKey;
  });
}

/** Whether this run has already posted at least one non-card, non-failure reply into the destination chat. */
export function hasPostedRunReply(messages: readonly Message[], runId: string): boolean {
  return messages.some((message) =>
    (message.automation?.runId === runId && message.kind === "text" && !message.automation.copyOf && !message.automation.failed)
    || message.routineRun?.runId === runId,
  );
}

/** Whether this run has already posted a failure line (or legacy card) into the destination chat. */
export function findPostedRunFailure(messages: readonly Message[], runId: string): Message | undefined {
  return messages.find((message) =>
    (message.automation?.runId === runId && message.kind === "text" && message.automation.failed === true)
    || message.routineRun?.runId === runId,
  );
}
