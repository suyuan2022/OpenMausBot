// suyuan fork: a reminder that needs no AI. A scheduled routine whose instructions open with PLAIN_MARK on a line of
// its own is not run by a model: when it is due, the rest of the instructions is posted as the bot's message, word for
// word. The mark lives in the instructions themselves, so it travels through every path a routine takes (the trigger
// tool, the Automations page, Undo, backup) with no field of its own, and a build that does not know it still delivers
// the reminder, by handing the text to the model.

export const PLAIN_MARK = "【原样发送，不调模型】";

/** The message a plain reminder sends, or null when these instructions are for a model. */
export function plainText(prompt: string | undefined | null): string | null {
  const text = (prompt ?? "").trimStart();
  if (!text.startsWith(PLAIN_MARK)) return null;
  const rest = text.slice(PLAIN_MARK.length).trim();
  return rest || null;
}

/** These instructions without the mark, as the person wrote them. */
export function withoutPlainMark(prompt: string): string {
  const text = prompt.trimStart();
  return text.startsWith(PLAIN_MARK) ? text.slice(PLAIN_MARK.length).trim() : prompt;
}

/** The instructions that make a routine send this text as it is. */
export function asPlain(text: string): string {
  return `${PLAIN_MARK}\n${withoutPlainMark(text).trim()}`;
}
