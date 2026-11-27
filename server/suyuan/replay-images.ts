// suyuan fork: a fresh engine session gets the person's earlier pictures again; mark each one where the model sees it, and keep a re-opened one out of the reply.
import { resolve, sep } from "node:path";

import { ATTACHMENTS_DIR } from "../attachments.ts";
import type { TurnImageInput, TurnVideoInput } from "../contracts.ts";
import { extractReplayImages, REPLAYED_IMAGE_NOTE, type ExtractTurnImagesOptions } from "../turn-images.ts";

const ATTACHMENT_TAG_LINE = /^[\t ]*<attached-(?:image|file)\b[^\n]*\/>[\t ]*$/gm;
const QUOTE_CHARS = 40;

function quoteOf(text: string): string {
  const words = text.replace(ATTACHMENT_TAG_LINE, "").replace(/\s+/g, " ").trim();
  return words.length > QUOTE_CHARS ? `${words.slice(0, QUOTE_CHARS)}…` : words;
}

export function replayedImageNote(messageText: string): string {
  const quote = quoteOf(messageText);
  const from = quote ? `an earlier message in this conversation (「${quote}」)` : "an earlier message in this conversation";
  return `[The next image is from ${from}, attached again only so you can still see it. It is not new: it was not sent with the latest message.]`;
}

/** extractReplayImages, with each re-attached image carrying a note that names the message it came from. */
export function extractLabelledReplayImages<T extends { role: "user" | "assistant"; text: string }>(
  transcript: readonly T[],
  current: readonly TurnImageInput[],
  options: ExtractTurnImagesOptions = {},
  clips: readonly TurnVideoInput[] = [],
): { transcript: T[]; images: TurnImageInput[] } {
  const replay = extractReplayImages(transcript, current, options, clips);
  const notes = replay.transcript.flatMap((entry, index) => {
    const original = transcript[index]!;
    if (entry === original) return [];
    return Array.from({ length: entry.text.split(REPLAYED_IMAGE_NOTE).length - 1 }, () => replayedImageNote(original.text));
  });
  return { transcript: replay.transcript, images: replay.images.map((image, index) => ({ ...image, note: notes[index] ?? replayedImageNote("") })) };
}

// Claude Code 2.1.x keeps the images of a prompt it was sent under <tmp>/claude-<uid>/<project>/<session>/images/ and names that path in the prompt.
const CLAUDE_PROMPT_IMAGE = /[\\/]claude-\d+[\\/][^\\/]+[\\/][0-9a-f-]{36}[\\/]images[\\/][^\\/]+$/;

export function reopensSentImage(toolName: string, input: unknown, attachmentsDir = ATTACHMENTS_DIR): boolean {
  if (toolName !== "Read" || !input || typeof input !== "object") return false;
  const path = (input as { file_path?: unknown }).file_path;
  if (typeof path !== "string") return false;
  return CLAUDE_PROMPT_IMAGE.test(path) || resolve(path).startsWith(resolve(attachmentsDir) + sep);
}

const reopened = new Set<string>();

export function rememberToolUse(id: string, toolName: string, input: unknown, attachmentsDir = ATTACHMENTS_DIR): void {
  if (reopensSentImage(toolName, input, attachmentsDir)) reopened.add(id);
}

/** The images of a tool result that should show in the chat: none when that call only re-opened a picture the person sent. */
export function shownToolImages<I>(toolUseId: string, images: readonly I[]): readonly I[] {
  return reopened.delete(toolUseId) ? [] : images;
}
