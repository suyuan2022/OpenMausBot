// suyuan fork: what a Chief reads of a teammate's conversation (server/suyuan/chief-read-threads.ts). A turn can run
// hundreds of tool steps, so the page is counted in words people said, not in rows: the steps between them fold into one
// line each, and the person's request that started the turn rides in front when the page would otherwise miss it.
import { activePath } from "../cloud-chat-merge.ts";
import { peerProvenanceAuthor } from "../peer-provenance.ts";
import { redactSecretsInText } from "../redact.ts";
import type { Message } from "../store.ts";

/** Rows fetched to build a page from; only the words in them count toward the page's limit. */
export const TAIL_ROWS = 500;
/** One message's body, and the whole reply: a long run would otherwise fill the Chief's context. */
export const MESSAGE_CHARS = 1500;
export const REPLY_CHARS = 16000;

export interface TeamMessageRow {
  id: string; at: number; speaker: string; kind: string;
  /** A one-line summary for a run of tool steps or a card; the body (cut, secrets masked) for words. */
  text: string; clipped?: true;
}

/** A step a teammate handed over or back: its words sit in the tool's output, and the chat shows them as a message. */
const handoff = (message: Message): boolean =>
  message.kind === "activity" && Boolean(message.tool?.output) && Boolean(message.relay || message.comm || message.threadRef || message.roomRequest);

const oneLine = (value: string, max: number): string => redactSecretsInText(value.replace(/\s+/g, " ").trim().slice(0, max));

function words(text: string, base: Omit<TeamMessageRow, "text">): TeamMessageRow {
  const body = redactSecretsInText(text);
  return body.length > MESSAGE_CHARS ? { ...base, text: `${body.slice(0, MESSAGE_CHARS)}…`, clipped: true } : { ...base, text: body };
}

/** Whose words these are, and the text (cut, secrets masked: a person's lines are stored as typed); null for a step. */
export function describeWords(message: Message, botName: string): TeamMessageRow | null {
  if (handoff(message)) {
    const other = message.comm?.withName;
    return words(`${message.tool!.name}: ${message.tool!.output}`, {
      id: message.id, at: message.at, kind: message.kind, speaker: other ? `@${other} (another bot, not the person)` : "a handoff",
    });
  }
  if (message.kind !== "text" || !message.text) return null;
  const peer = message.peerAsk?.name ?? peerProvenanceAuthor(message.text);
  const speaker = peer ? `@${peer} (another bot, not the person)` : message.role === "user" ? "the person" : message.from?.name ?? botName;
  return words(message.text, { id: message.id, at: message.at, kind: message.kind, speaker });
}

const stepLine = (message: Message): string => {
  if (message.kind === "activity" && message.tool) {
    const detail = message.tool.summary ? `: ${oneLine(message.tool.summary, 120)}` : "";
    return redactSecretsInText(`${message.tool.name}${message.tool.ok === false ? " (failed)" : ""}${detail}`);
  }
  return `[${message.kind}${message.text ? `: ${oneLine(message.text, 120)}` : ""}]`;
};

/** The current branch only: a message the person edited leaves the old answer stored beside the new one. */
function currentBranch(messages: readonly Message[], leaf: string | null): readonly Message[] {
  // A row without parentId is a legacy one: the chain cannot be followed, so the stored order stands.
  if (!leaf || messages.some((message) => message.parentId === undefined) || !messages.some((message) => message.id === leaf)) return messages;
  return activePath(messages, leaf);
}

export function readablePage(all: readonly Message[], leaf: string | null, hasMore: boolean, limit: number, botName: string): { rows: TeamMessageRow[]; earlier: boolean } {
  const branch = currentBranch(all, leaf).filter((message) => message.kind !== "digest");
  const spoken = new Set<string>();
  // Newest first: take words until the limit, folding the steps between them, and stop when the reply is full.
  const rows: TeamMessageRow[] = [];
  let budget = REPLY_CHARS, count = 0, steps: Message[] = [];
  const flush = () => {
    if (!steps.length) return;
    const last = steps.at(-1)!;
    const text = `(${steps.length} tool step${steps.length === 1 ? "" : "s"}, last: ${stepLine(last)})`;
    rows.push({ id: last.id, at: last.at, speaker: botName, kind: "steps", text: text.slice(0, 300) });
    budget -= Math.min(text.length, 300);
    steps = [];
  };
  let index = branch.length - 1;
  for (; index >= 0 && budget > 0; index--) {
    const message = branch[index]!;
    const said = describeWords(message, botName);
    if (!said) { steps.unshift(message); continue; }
    if (count >= limit) break;
    flush();
    rows.push(said);
    spoken.add(message.id);
    budget -= said.text.length;
    count++;
  }
  flush();
  // The request the newest work answers goes in front, when the page does not already start with it.
  const newest = branch.findLast((message) => message.requestMessageId);
  const request = newest && !spoken.has(newest.requestMessageId!) ? branch.find((message) => message.id === newest.requestMessageId) : undefined;
  const asked = request && describeWords(request, botName);
  const page = rows.reverse();
  if (asked) page.unshift(asked);
  // Anything left unread before the page, apart from the request that was brought forward.
  return { rows: page, earlier: hasMore || branch.slice(0, index + 1).some((message) => message !== request) };
}
