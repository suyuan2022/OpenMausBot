// suyuan fork: the simple bot list says when each bot last wrote in words that fit how long ago, and leads with the newest.
import { afterAll, describe, expect, it } from "vitest";

import { formatTime } from "@/lib/clock-time";
import { loadLocale, setLocale } from "@/lib/i18n";
import { listTime, recentBotsFirst } from "./list-order";

const now = new Date(2026, 10, 14, 3, 5).getTime();
const at = (...parts: [number, number, number, number, number]) => new Date(...parts).getTime();

describe("the time on a phone's bot row", () => {
  afterAll(() => setLocale("en"));

  it("is the clock today, then yesterday, the weekday within the week, the date this year and the full date before", async () => {
    await loadLocale("zh");
    expect(listTime(at(2026, 10, 14, 0, 13), now)).toBe(formatTime(at(2026, 10, 14, 0, 13)));
    expect(listTime(at(2026, 10, 13, 18, 50), now)).toBe("昨天");
    expect(listTime(at(2026, 10, 11, 20, 7), now)).toBe("星期三");
    expect(listTime(at(2026, 10, 8, 9, 0), now)).toBe("星期日");
    expect(listTime(at(2026, 10, 7, 23, 59), now)).toBe("11月7日");
    expect(listTime(at(2026, 0, 2, 17, 24), now)).toBe("1月2日");
    expect(listTime(at(2025, 9, 2, 14, 54), now)).toBe("2025/10/2");
  });

  it("counts calendar days, not 24 hours, and shows a time from a clock ahead as the time", async () => {
    await loadLocale("zh");
    expect(listTime(at(2026, 10, 13, 23, 59), at(2026, 10, 14, 0, 1))).toBe("昨天");
    expect(listTime(at(2026, 10, 14, 0, 1), at(2026, 10, 14, 23, 59))).toBe(formatTime(at(2026, 10, 14, 0, 1)));
    expect(listTime(now + 60_000, now)).toBe(formatTime(now + 60_000));
  });

  it("speaks English too", async () => {
    await loadLocale("en");
    expect(listTime(at(2026, 10, 13, 18, 50), now)).toBe("Yesterday");
    expect(listTime(at(2026, 10, 11, 20, 7), now)).toBe("Wednesday");
    expect(listTime(at(2026, 10, 2, 17, 24), now)).toBe("Nov 2");
  });
});

type TestBot = { id: string; messages: { kind: string; at: number }[] };
const bot = (id: string, ...times: number[]): TestBot => ({ id, messages: times.map((time) => ({ kind: "text", at: time })) });
const order = recentBotsFirst((b: TestBot) => b.messages);
const ids = (bots: TestBot[]) => bots.map((b) => b.id);

describe("the order of a phone's bot list", () => {
  it("puts the bot with the newest message first, keeps the saved order on a tie, and a bot with none last", () => {
    const list = [bot("loop", 30), bot("empty"), bot("research", 10, 50), bot("shopping", 30), bot("styling", 20)];
    const { unsectionedBots } = order({ pinnedBots: [], sectionedBots: [], unsectionedBots: list }, () => false);
    expect(ids(unsectionedBots)).toEqual(["research", "loop", "shopping", "styling", "empty"]);
  });

  it("orders the bots working or waiting on the person by their newest message too, not ahead of the rest", () => {
    const list = [bot("a", 10), bot("b", 50), bot("c", 20), bot("d", 40)];
    const busy = new Set(["a", "c"]);
    const { unsectionedBots } = order({ pinnedBots: [], sectionedBots: [], unsectionedBots: list }, (b) => busy.has(b.id));
    expect(ids(unsectionedBots)).toEqual(["b", "d", "c", "a"]);
  });

  it("orders each department's bots the same way and leaves the pinned tiles in the person's order", () => {
    const pinned = [bot("p1", 10), bot("p2", 90)];
    const sectioned = [bot("s1", 10), bot("s2", 20)];
    const parts = order({ pinnedBots: pinned, sectionedBots: sectioned, unsectionedBots: [] }, () => false);
    expect(ids(parts.pinnedBots)).toEqual(["p1", "p2"]);
    expect(ids(parts.sectionedBots)).toEqual(["s2", "s1"]);
  });

  it("does not count a receipt as the bot's last message", () => {
    const quiet = { id: "quiet", messages: [{ kind: "text", at: 10 }, { kind: "digest", at: 99 }] };
    const { unsectionedBots } = order({ pinnedBots: [], sectionedBots: [], unsectionedBots: [quiet, bot("loud", 20)] }, () => false);
    expect(ids(unsectionedBots)).toEqual(["loud", "quiet"]);
  });
});
