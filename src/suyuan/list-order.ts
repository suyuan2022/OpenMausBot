// suyuan fork (FORK.md): the simple bot list, on a phone and on a computer, reads like a chat app's. Each row says when its
// last message came in words that fit how long ago it was, not a clock time that could be any day, and the bots with the
// newest messages come first.
import { formatTime } from "@/lib/clock-time";
import { intlLocale, t } from "@/lib/i18n";
import { lastNonReceipt } from "@/lib/receipts";
import { activeBotsFirst } from "@/lib/sidebar-layout";

const DAY_MS = 86_400_000;

/** Days since some fixed day, counted in local calendar days. */
function localDay(at: number): number {
  const date = new Date(at);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
}

const formats = new Map<string, Intl.DateTimeFormat>();
function formatted(at: number, options: Intl.DateTimeFormatOptions): string {
  const locale = intlLocale();
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = formats.get(key);
  if (!format) formats.set(key, (format = new Intl.DateTimeFormat(locale, options)));
  return format.format(at);
}

/** "18:50" today, "昨天", "星期三" within the week, "11月2日" this year, "2025/10/2" before it. */
export function listTime(at: number, now = Date.now()): string {
  const days = localDay(now) - localDay(at);
  if (!(days > 0)) return formatTime(at);
  if (days === 1) return t("chat.day.yesterday");
  if (days < 7) return formatted(at, { weekday: "long" });
  if (new Date(at).getFullYear() === new Date(now).getFullYear()) return formatted(at, { month: "short", day: "numeric" });
  return formatted(at, { year: "numeric", month: "numeric", day: "numeric" });
}

type Parts<T> = { pinnedBots: T[]; sectionedBots: T[]; unsectionedBots: T[] };

/** activeBotsFirst for the simple list: the bot with the newest message comes first, working or done, so the list says
 * which bot to read next. Pinned bots, the tiles, keep activeBotsFirst's. */
export function recentBotsFirst<B>(messagesOf: (bot: B) => readonly { kind: string; at: number }[]) {
  return <T extends B>(parts: Parts<T>, active: (bot: T) => boolean): Parts<T> => {
    const byRecent = (bots: T[]) => bots
      .map((bot, index) => ({ bot, index, at: lastNonReceipt(messagesOf(bot))?.at ?? 0 }))
      .sort((a, b) => b.at - a.at || a.index - b.index)
      .map((entry) => entry.bot);
    return { pinnedBots: activeBotsFirst({ ...parts, sectionedBots: [], unsectionedBots: [] }, active).pinnedBots, sectionedBots: byRecent(parts.sectionedBots), unsectionedBots: byRecent(parts.unsectionedBots) };
  };
}
