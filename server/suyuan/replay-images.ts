// suyuan fork: a fresh engine session gets the person's earlier pictures as files to open, not as pictures of the latest message; a re-opened one stays out of the reply.
import { resolve, sep } from "node:path";

import { ATTACHMENTS_DIR } from "../attachments.ts";
import { extractTurnImages, type ExtractTurnImagesOptions } from "../turn-images.ts";

/** Put where an earlier message's image was. A model takes any image in the turn for one sent with the latest message, even beside a note saying otherwise, so the image itself stays out. */
export const EARLIER_IMAGE_NOTE =
  "[The person attached an image to this earlier message. It is not attached to the latest message. To look at it again, open the file below with your file-reading tool.]";

function withImageFiles<T extends { role: "user" | "assistant"; text: string }>(entry: T, options: ExtractTurnImagesOptions): T {
  if (entry.role !== "user") return entry;
  const item = extractTurnImages(entry.text, { ...options, maxCount: Infinity, maxBytes: Infinity, imageNote: EARLIER_IMAGE_NOTE });
  return item.images.length ? { ...entry, text: item.text } : entry;
}

/** Stands in for extractReplayImages: the replayed messages name their images as files, and no image rides on the turn. */
export function replayImagesAsFiles<T extends { role: "user" | "assistant"; text: string }>(
  transcript: readonly T[],
  options: ExtractTurnImagesOptions = {},
): { transcript: T[]; images: [] } {
  return { transcript: transcript.map((entry) => withImageFiles(entry, options)), images: [] };
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
