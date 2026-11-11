// suyuan fork: a room turn marks the whole bot busy (the server's store.setActivity), while the bot's own conversations
// carry their own busy flags. The bot's row in the list speaks for its own conversations, so a turn in a room does not
// make it say it is working. A bot that lists no conversations falls back on the whole bot's flag.
// With the thread list hidden only the bot's home counts: work in a background run does not show on the row (./home.ts).
import type { Bot } from "@/state/store";
import { foreground, threadsShownNow } from "./home";

export function busyInOwnChats(bot: Pick<Bot, "busy" | "tasks"> & Partial<Pick<Bot, "mainThreadId">>): boolean {
  return bot.tasks?.length ? foreground(bot, threadsShownNow()).tasks!.some((task) => Boolean(task.busy)) : Boolean(bot.busy);
}
