// suyuan fork: a room turn marks the whole bot busy (the server's store.setActivity), while the bot's own conversations
// carry their own busy flags. The bot's row in the list speaks for its own conversations, so a turn in a room does not
// make it say it is working. A bot that lists no conversations falls back on the whole bot's flag.
import type { Bot } from "@/state/store";

export function busyInOwnChats(bot: Pick<Bot, "busy" | "tasks">): boolean {
  return bot.tasks?.length ? bot.tasks.some((task) => Boolean(task.busy)) : Boolean(bot.busy);
}
