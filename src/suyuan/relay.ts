// suyuan fork (FORK.md): a background run another bot opened is that bot passing work on, as 荔枝 passes the person's words
// to shopping. Its header says so, "荔枝 → shopping", where upstream's "shopping › <title>" read as an arrow the wrong way,
// and the way out of it, 返回 or Esc, leads back where the person came in: the conversation of the bot that passed it on,
// where its chip sits. A run the bot opened itself, or a scheduled one, goes back to the bot's own conversation as before.
import type { Action, Bot } from "@/state/store";
import { openBot, openBotThread } from "@/state/thread-navigation";
import { homeOf, oneConversation } from "./home";

type Opener = { botId?: string; name?: string; threadId?: string };
type Owner = {
  id: string;
  threadId: string;
  mainThreadId?: string;
  tasks?: ReadonlyArray<{ threadId: string; openedBy?: Opener | null }> | null;
};

export type PassedOn = { botId: string; name: string; threadId?: string };

/** The bot that passed the thread on screen to this one, while the app offers one conversation per bot; null otherwise.
 * The bot's home names nobody, even when another bot once opened the thread the person later made the home. */
export function passedOnBy(bot: Owner): PassedOn | null {
  if (!oneConversation() || bot.threadId === homeOf(bot)) return null;
  const opener = bot.tasks?.find((task) => task.threadId === bot.threadId)?.openedBy;
  if (!opener?.botId || opener.botId === bot.id || !opener.name) return null;
  return { botId: opener.botId, name: opener.name, ...(opener.threadId ? { threadId: opener.threadId } : {}) };
}

/** Where 返回 leads: the passing bot's conversation it came from while that bot still has it, else that bot; with no
 * passing bot still there, this bot's own conversation. `threadId` is unset when the bot's own conversation is meant. */
export function backFrom<B extends Owner>(bot: B, bots: readonly B[]): { bot: B; threadId?: string } {
  const opener = passedOnBy(bot);
  const from = opener ? bots.find((candidate) => candidate.id === opener.botId) : undefined;
  if (!opener || !from) return { bot };
  const kept = opener.threadId !== undefined
    && (from.threadId === opener.threadId || Boolean(from.tasks?.some((task) => task.threadId === opener.threadId)));
  return kept && opener.threadId !== homeOf(from) ? { bot: from, threadId: opener.threadId } : { bot: from };
}

export function goBack(dispatch: (action: Action) => void, bot: Bot, bots: readonly Bot[]): void {
  const back = backFrom(bot, bots);
  if (back.threadId) openBotThread(dispatch, back.bot, back.threadId, false);
  else openBot(dispatch, back.bot, false);
}

const OPEN_LAYER = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** Whether this Escape means 返回: nothing typed into, no dialog or menu open for it to close first. */
export function escapeGoesBack(
  event: Pick<KeyboardEvent, "key" | "defaultPrevented" | "isComposing" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "target">,
  doc: Pick<Document, "querySelector"> = document,
): boolean {
  if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const target = event.target as Partial<HTMLElement> | null;
  const tag = typeof target?.tagName === "string" ? target.tagName.toLowerCase() : "";
  if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) return false;
  return !doc.querySelector(OPEN_LAYER);
}
