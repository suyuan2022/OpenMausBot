// suyuan fork (FORK.md): a bot that handed work to a teammate and waits for the answer puts no dot on its avatar. It needs
// nothing from the person, and upstream's blue dot read as one more unread. Its line in the list says whose answer it waits
// for instead ("在等 Maus 工程师回话"), from the server's `waitingOn` (server/suyuan/inbox-read.ts).
import { activeLocale, t } from "@/lib/i18n";
import { foreground } from "./home";

type Waits = { waitingForTeammates?: boolean; waitingOn?: string[] };
type Waiter = Waits & { tasks?: ReadonlyArray<Waits & { routineRunId?: unknown; threadId?: string }> | null };

// Every bot's name by id, as the app shell last rendered them; useSuyuan fills it before the list renders.
let names = new Map<string, string>();

export function noteBotNames(bots: ReadonlyArray<{ id: string; name: string }>): void {
  if (bots.length === names.size && bots.every((bot) => names.get(bot.id) === bot.name)) return;
  names = new Map(bots.map((bot) => [bot.id, bot.name]));
}

/** The teammates the bot's own conversations wait on, by name, each once. */
export function awaitedNames(bot: Waiter): string[] {
  const waits = [bot, ...(foreground(bot).tasks ?? []).filter((task) => !task.routineRunId)].filter((one) => one.waitingForTeammates);
  const ids = new Set(waits.flatMap((one) => one.waitingOn ?? []));
  return [...ids].flatMap((id) => names.get(id) ?? []);
}

/** The list's line for a bot waiting on teammates: "在等 X 回话", or upstream's words when it does not know who. */
export function waitingOnLine(bot: Waiter): string {
  const who = awaitedNames(bot);
  if (who.length === 0) return t("sidebar.preview.waitingOnTeammate");
  if (!activeLocale().startsWith("zh")) return `Waiting on ${who.join(", ")}…`;
  const list = who.join("、");
  // A space between Chinese and a Latin name's edge, as he writes it: "在等 Maus 工程师回话".
  return `在等${/^[A-Za-z0-9]/.test(list) ? " " : ""}${list}${/[A-Za-z0-9]$/.test(list) ? " " : ""}回话`;
}
