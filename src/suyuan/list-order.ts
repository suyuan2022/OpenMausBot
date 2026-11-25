// suyuan fork: while each bot has the one conversation (./home.ts), the bot list reads like a chat app's: the bot with the
// newest message comes first, working or done, so the list says which bot to read next. Pinned bots keep upstream's
// order (sidebar-layout.ts, activeBotsFirst).
import { lastNonReceipt } from "@/lib/receipts";
import { visibleMessages } from "@/state/snapshot-navigation";
import type { Bot } from "@/state/store";

import { homeOf, oneConversation } from "./home";

type Owner = {
  threadId?: string;
  mainThreadId?: string;
  tasks?: ReadonlyArray<{ threadId?: string; updatedAt?: number }> | null;
  messages?: Bot["messages"];
  activeLeafId?: Bot["activeLeafId"];
};

/** When a bot's row last moved: the last message of the branch on screen, the one whose time the row shows
 * (Sidebar.tsx), unless the app holds one of its background runs, whose messages say nothing of the bot's own
 * conversation; then the last time its home moved. */
export function rowAt(bot: Owner): number {
  const at = lastNonReceipt(visibleMessages({ messages: bot.messages ?? [], activeLeafId: bot.activeLeafId ?? null }))?.at ?? 0;
  const home = homeOf(bot);
  if (home === undefined || bot.threadId === home) return at;
  return bot.tasks?.find((task) => task.threadId === home)?.updatedAt ?? at;
}

/** The main and department lists, newest first, while the app keeps one conversation per bot; null elsewhere. */
export function recentBotsFirst<T>(parts: { sectionedBots: T[]; unsectionedBots: T[] }): { sectionedBots: T[]; unsectionedBots: T[] } | null {
  if (!oneConversation()) return null;
  const byRecent = (bots: T[]) => bots
    .map((bot, index) => ({ bot, index, at: rowAt(bot as Owner) }))
    .sort((a, b) => b.at - a.at || a.index - b.index)
    .map((entry) => entry.bot);
  return { sectionedBots: byRecent(parts.sectionedBots), unsectionedBots: byRecent(parts.unsectionedBots) };
}
