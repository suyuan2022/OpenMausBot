// suyuan fork: automation runs that span multiple turns (handing work to a teammate and resuming) or call attach_file
// used to lose earlier turns' replies and every attach_file attachment when reporting into the main chat.
// Upstream only reported once the whole run completed, reading only the last turn's text message and only attachments
// stored directly on that message (while attach_file appends a separate empty-text message with no turnId).
// Here each settled routine turn (waiting on teammates or completed) delivers its own non-quiet reply along with all
// attachments produced in that turn, while quiet turns (NOTHING NEW) still drop their attachments and never erase an
// earlier turn's report.
import type { Message } from "../store.ts";
import type { RoutineRun } from "../routines.ts";

export type TurnAttachment = NonNullable<Message["attachments"]>[number];

const isBotText = (message: Message): boolean => message.role === "bot" && message.kind === "text";

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

/** Deduplicate attachments by path while preserving order. */
function collectAttachments(slice: readonly Message[]): TurnAttachment[] {
  const seen = new Set<string>();
  const out: TurnAttachment[] = [];
  for (const message of slice) {
    if (!isBotText(message) || !message.attachments?.length) continue;
    for (const attachment of message.attachments) {
      if (seen.has(attachment.path)) continue;
      seen.add(attachment.path);
      out.push(attachment);
    }
  }
  return out;
}

/** Slice a run thread's active path down to one turn's messages, including unstamped attach_file rows that landed in
 * that turn, without crossing into an earlier or later turn. */
function sliceTurn(path: readonly Message[], turnId?: string, messageId?: string): readonly Message[] {
  const explicit = messageId ? path.find((message) => message.id === messageId) : undefined;
  const effectiveTurnId = turnId ?? explicit?.turnId;

  if (effectiveTurnId) {
    let first = -1;
    let last = -1;
    for (let i = 0; i < path.length; i += 1) {
      const m = path[i]!;
      if (m.role !== "user" && m.turnId === effectiveTurnId) {
        if (first < 0) first = i;
        last = i;
      }
    }
    if (first >= 0) {
      let start = first;
      while (start > 0) {
        const prev = path[start - 1]!;
        if (prev.role === "user" || prev.turnTerminal || prev.kind === "digest" || Boolean(prev.roomRequest)
          || (prev.turnId !== undefined && prev.turnId !== effectiveTurnId)) break;
        start -= 1;
      }
      let end = last;
      while (end + 1 < path.length) {
        const next = path[end + 1]!;
        if (path[end]!.kind === "digest" || next.role === "user" || next.kind === "digest" || Boolean(next.roomRequest)
          || (next.turnId !== undefined && next.turnId !== effectiveTurnId)) break;
        end += 1;
      }
      return path.slice(start, end + 1);
    }
    // Turn emitted no turnId-stamped rows (e.g. only unstamped attach_file): take only trailing unstamped bot rows.
    let start = path.length;
    while (start > 0) {
      const prev = path[start - 1]!;
      if (prev.role === "user" || prev.turnTerminal || prev.kind === "digest" || Boolean(prev.roomRequest) || prev.turnId !== undefined) break;
      start -= 1;
    }
    return path.slice(start);
  }

  if (explicit) {
    const idx = path.findIndex((message) => message.id === explicit.id);
    if (idx < 0) return [];
    let start = idx;
    while (start > 0) {
      const prev = path[start - 1]!;
      if (prev.role === "user" || prev.turnTerminal || prev.kind === "digest" || Boolean(prev.roomRequest) || prev.turnId !== undefined) break;
      start -= 1;
    }
    let end = idx;
    while (end + 1 < path.length) {
      const next = path[end + 1]!;
      if (next.role === "user" || next.kind === "digest" || Boolean(next.roomRequest) || next.turnId !== undefined) break;
      end += 1;
    }
    return path.slice(start, end + 1);
  }

  // Fallback with neither turnId nor messageId: pick the slice around the latest terminal (or latest) bot text.
  const latest = path.findLast((message) => isBotText(message) && message.turnTerminal) ?? path.findLast(isBotText);
  if (!latest) return [];
  return sliceTurn(path, latest.turnId, latest.id);
}

/** Extract the final reply message and every attachment produced during one routine turn. */
export function extractTurnReport(
  path: readonly Message[],
  turnId?: string,
  messageId?: string,
): { source: Message | undefined; attachments: TurnAttachment[] } {
  const slice = sliceTurn(path, turnId, messageId);
  const explicit = messageId ? path.find((message) => message.id === messageId) : undefined;
  const effectiveTurnId = turnId ?? explicit?.turnId;

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
      if (!seen.has(attachment.path)) {
        seen.add(attachment.path);
        attachments.push(attachment);
      }
    }
  }
  return { source, attachments };
}

/** Identify routine turns in a run's transcript for restart recovery, skipping any side turns started by a person
 * messaging inside the run's hidden conversation. */
export function collectRecoverableRoutineTurns(path: readonly Message[]): Array<{ turnId?: string; messageId?: string }> {
  const personTurnIds = new Set<string>();
  let sawPrompt = false;
  let awaitingPersonTurn = false;
  for (const message of path) {
    if (message.role === "user") {
      if (!sawPrompt) sawPrompt = true;
      else awaitingPersonTurn = true;
      continue;
    }
    if (awaitingPersonTurn && message.turnId) {
      personTurnIds.add(message.turnId);
      awaitingPersonTurn = false;
    }
  }

  const turns: Array<{ turnId?: string; messageId?: string }> = [];
  const seen = new Set<string>();
  for (const message of path) {
    if (!isBotText(message)) continue;
    if (message.turnId && personTurnIds.has(message.turnId)) continue;
    if (message.turnSucceeded === false) continue;
    if (message.turnTerminal) {
      if (message.turnId) {
        if (!seen.has(message.turnId)) {
          seen.add(message.turnId);
          turns.push({ turnId: message.turnId, messageId: message.id });
        }
      } else {
        turns.push({ messageId: message.id });
      }
    }
  }
  if (turns.length > 0) return turns;

  // Legacy / test fixtures without turnTerminal (or attach_file-only runs): fall back to the latest non-person bot text.
  const latest = path.findLast((message) => isBotText(message) && !(message.turnId && personTurnIds.has(message.turnId)));
  return latest ? [{ ...(latest.turnId ? { turnId: latest.turnId } : {}), messageId: latest.id }] : [];
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
