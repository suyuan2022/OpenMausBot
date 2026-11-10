// suyuan fork: Gemini 4, driven by OpenMausBot through Antigravity, writes each tool call a second time as text, at the
// end of the sentence it says before the call:
//   我先去翻翻记录 🔍工具调用_start:[{"name": "run_command", "args": {"CommandLine": "ls …"}}]工具调用_end
// The call itself still arrives as a real tool call and is drawn as a step; the copy is hundreds of characters of JSON
// in the chat bubble. On 2026-11-10, 31 of the 32 replies of a bot on gemini-4-argon carried one, while the same model
// in Antigravity's own window wrote none in 60 replies: the cause lies in how it is driven from here and is not known.
// stripToolEcho() cuts the copy out. shared/system-message-guard.ts calls it, which covers both ends: the server stores
// a reply without the copy (server/drivers/acp/core.ts flushes a reply through that guard), and the chat draws the
// replies stored before this without it (ChatView.tsx, GroupView.tsx and CallSheet.tsx render through the same guard).
// A chat bubble is only ever a stored, whole reply, so a copy that is still streaming in needs no handling.

/** A whole copy: both marks, and between them a JSON list that is empty or opens with a call's name. Anything looser
 * also took the words after a sentence or a code block that only names the mark, and on the server those are gone for
 * good. A copy cut short by Stop keeps its JSON, which is rare and shows what happened. */
const ECHO = /工具调用_start:\[\s*(?:\{\s*"name"\s*:[\s\S]*?)?\]\s*工具调用_end/g;

export function stripToolEcho(text: string): string {
  return text.includes("工具调用_start:[") ? text.replace(ECHO, "") : text;
}
