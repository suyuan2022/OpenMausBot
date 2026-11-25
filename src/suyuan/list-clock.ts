// suyuan fork: the clock the bot list reads. Sidebar.tsx stays upstream's file; its calls of the clock are pointed here
// as it is compiled (scripts/suyuan/vite-list-clock.ts). A row's bare clock time could be any day, and the list is sorted
// newest first (./list-order.ts), so a row says "18:50" today, "昨天", the weekday within the week, "11月2日" this year,
// "2025/10/2" before it. Everywhere else keeps the clock.
import { formatTime as clockTime } from "@/lib/clock-time";
import { intlLocale, t } from "@/lib/i18n";

const DAY_MS = 86_400_000;

/** Days since a fixed day, counted in local calendar days. */
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

export function formatTime(at: number, now = Date.now()): string {
  if (Number.isNaN(new Date(at).getTime())) return clockTime(at);
  const days = localDay(now) - localDay(at);
  if (!(days > 0)) return clockTime(at);
  if (days === 1) return t("chat.day.yesterday");
  if (days < 7) return formatted(at, { weekday: "long" });
  if (new Date(at).getFullYear() === new Date(now).getFullYear()) return formatted(at, { month: "short", day: "numeric" });
  return formatted(at, { year: "numeric", month: "numeric", day: "numeric" });
}
