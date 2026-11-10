// suyuan fork: Gemini 4, driven by OpenMausBot through Antigravity, writes each tool call a second time as text, at the
// end of the sentence it says before the call:
//   我先去翻翻记录 🔍工具调用_start:[{"name": "run_command", "args": {"CommandLine": "ls …"}}]工具调用_end
// The call itself still arrives as a real tool call and is drawn as a step; the copy is hundreds of characters of JSON
// in the chat bubble. On 2026-11-10, 31 of the 32 replies of a bot on gemini-4-argon carried one, while the same model
// in Antigravity's own window wrote none in 60 replies: the cause lies in how it is driven from here and is not known.
// stripToolEcho() cuts the copy out. shared/system-message-guard.ts calls it, which covers both ends. The server stores
// a reply without the copy (server/drivers/acp/core.ts flushes a reply through that guard), and the chat draws stored
// replies and ones still streaming in without it (ChatView.tsx, GroupView.tsx and CallSheet.tsx render through it).

/** A whole copy, or one still streaming in with no end mark yet. Only what opens like a JSON list is taken, so a
 * sentence that names the mark keeps its words. */
const ECHO = /工具调用_start:\[(?:\s*\{[\s\S]*?)?(?:\]\s*工具调用_end|$)/g;
/** The first characters of a copy, at the very end of a reply that is still streaming in. */
const OPENING = /工具调用_(?:s(?:t(?:a(?:r(?:t:?)?)?)?)?)?$/;

export function stripToolEcho(text: string): string {
  if (!text.includes("工具调用_")) return text;
  return text.replace(ECHO, "").replace(OPENING, "");
}
