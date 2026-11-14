// suyuan fork (FORK.md): in Simple mode a bot's row in the list says the last thing said in its conversation, also while
// the bot works, in place of upstream's live step ("思考中", "正在执行命令") that changes every few seconds. Its face still
// moves and its dot still says it is working. A bot waiting on the person still says so: that line asks them to act.
// All-English lines along the way stay out here as in the chat (./quiet-english.ts).
// The row speaks for the bot's own conversation only. When the person last read one of its background runs (work another
// bot passed on), the app still holds that run's messages for the bot, so the row reads its home's newest page instead:
// read, not opened, so nothing there is marked read.
import { useEffect, useState } from "react";

import { lastLine } from "@/components/sidebar-preview";
import { failedTurnCause, STATUS_MARKER } from "@/lib/failed-turn";
import { t } from "@/lib/i18n";
import { api } from "@/state/api";
import { visibleMessages } from "@/state/snapshot-navigation";
import type { Bot, InstanceInfo, Message } from "@/state/store";
import { isStoppedTurnName } from "../../shared/client-cancel";
import { homeOf, oneConversation } from "./home";
import { withoutEnglishSteps } from "./quiet-english";

const HOME_PAGE = 20;

/** A tool step that went fine: what the row no longer quotes. A failed or stopped turn still speaks for itself. */
function plainStep(message: Message): boolean {
  if (message.kind === "screen") return true;
  const tool = message.kind === "activity" ? message.tool : undefined;
  return Boolean(tool) && !message.dataResult && failedTurnCause(tool!.name) === null && !isStoppedTurnName(tool!.name) && !STATUS_MARKER.test(tool!.name);
}

/** Whether a row in the list is quiet: a Simple row, once the app shell says the thread list is hidden (./home.ts), so a
 * test that never mounts the shell sees upstream's row. */
export function quietRow(simpleRow: boolean): boolean {
  return simpleRow && oneConversation();
}

/** The row's line from the conversation's visible messages; `running`: its newest turn is still going. */
export function quietRowLine(bot: Bot, visible: Message[], running: boolean, instances: InstanceInfo[], waiting: boolean): string {
  if (waiting) return t("sidebar.preview.waiting");
  return lastLine(bot, withoutEnglishSteps(visible.filter((message) => !plainStep(message)), running), instances, false);
}

/** The bot's home while the app holds another of its threads, with what marks a change there; null on home. */
export function awayFromHome(bot: Pick<Bot, "threadId" | "mainThreadId" | "tasks">): { home: string; busy: boolean; key: string } | null {
  const home = homeOf(bot);
  if (home === undefined || bot.threadId === home) return null;
  const task = bot.tasks?.find((candidate) => candidate.threadId === home);
  return { home, busy: Boolean(task?.busy), key: [home, task?.updatedAt ?? 0, task?.busy ? 1 : 0, task?.activity ?? "", task?.unread ? 1 : 0].join(":") };
}

export function QuietRowLine({ bot, visible, instances, waiting }: { bot: Bot; visible: Message[]; instances: InstanceInfo[]; waiting: boolean }) {
  const away = awayFromHome(bot);
  const [home, setHome] = useState<{ threadId: string; messages: Message[] } | null>(null);
  const key = away?.key;
  useEffect(() => {
    if (!away) return;
    let live = true;
    api<{ messages?: Message[]; activeLeafId?: string | null }>(`/api/threads/${away.home}/messages?limit=${HOME_PAGE}`)
      .then((page) => {
        if (live) setHome({ threadId: away.home, messages: visibleMessages({ messages: page.messages ?? [], activeLeafId: page.activeLeafId ?? undefined }) });
      })
      .catch(() => {});
    return () => { live = false; };
    // The key carries the home and every change there worth reading again for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!away) return quietRowLine(bot, visible, Boolean(bot.tasks?.find((task) => task.threadId === bot.threadId)?.busy ?? bot.busy), instances, waiting);
  // Until the home's page is in, the line stays empty rather than quote the run.
  const lines = home?.threadId === away.home ? home.messages : [];
  return quietRowLine(bot, lines, away.busy, instances, waiting);
}
