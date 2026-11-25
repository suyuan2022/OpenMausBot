// suyuan fork: the phone's bot list as he set it (FORK.md): pinned bots beside the chief, newest message first, a green dot
// only for something new, and times that say the day.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatTime as clockTime } from "@/lib/clock-time";
import { setLocale } from "@/lib/i18n";
import { listClockSource } from "../../scripts/suyuan/vite-list-clock";
import { heroPins, notePhoneHome, pinsBesideChief } from "./hero-pins";
import { noteThreadsShown } from "./home";
import { formatTime } from "./list-clock";
import { recentBotsFirst } from "./list-order";
import { busyDotShown, unreadTone } from "./quiet-dots";

afterEach(() => {
  notePhoneHome(false);
  noteThreadsShown(true);
});

describe("pinned bots beside the chief", () => {
  const chief = { id: "chief" };
  const pinned = [{ id: "mate" }];
  const plain = { searching: false, universalPins: false };

  it("moves the pinned bots from their own section into the chief's tiles on the phone's list", () => {
    notePhoneHome(true);
    expect(pinsBesideChief(pinned, chief, plain)).toEqual([]);
    expect(heroPins(chief)).toEqual(pinned);
  });

  it("leaves upstream's section while searching, with pins everywhere, without a chief or off the phone", () => {
    notePhoneHome(true);
    expect(pinsBesideChief(pinned, chief, { ...plain, searching: true })).toBe(pinned);
    expect(heroPins(chief)).toEqual([]);
    expect(pinsBesideChief(pinned, chief, { ...plain, universalPins: true })).toBe(pinned);
    expect(pinsBesideChief(pinned, null, plain)).toBe(pinned);
    notePhoneHome(false);
    expect(pinsBesideChief(pinned, chief, plain)).toBe(pinned);
    expect(heroPins(chief)).toEqual([]);
  });
});

describe("the list, newest message first", () => {
  const bot = (name: string, at?: number) => ({ name, threadId: "t", messages: at === undefined ? [] : [{ kind: "text", at }] });

  it("puts the bot with the newest message first while each bot has one conversation", () => {
    noteThreadsShown(false);
    const sorted = recentBotsFirst({ sectionedBots: [], unsectionedBots: [bot("old", 10), bot("none"), bot("new", 30), bot("mid", 20)] });
    expect(sorted?.unsectionedBots.map((one) => one.name)).toEqual(["new", "mid", "old", "none"]);
  });

  it("leaves upstream's order with the thread list shown", () => {
    noteThreadsShown(true);
    expect(recentBotsFirst({ sectionedBots: [], unsectionedBots: [bot("a", 1), bot("b", 2)] })).toBeNull();
  });
});

describe("the dots", () => {
  it("shows no busy dot and a green unread dot while each bot has one conversation", () => {
    noteThreadsShown(false);
    expect(busyDotShown()).toBe(false);
    expect(unreadTone()).toBe("bg-success");
  });

  it("keeps upstream's dots with the thread list shown", () => {
    noteThreadsShown(true);
    expect(busyDotShown()).toBe(true);
    expect(unreadTone()).toBe("bg-accent");
  });
});

describe("the list's times", () => {
  beforeEach(() => setLocale("zh"));
  afterEach(() => setLocale("en"));
  const now = new Date(2026, 10, 25, 19, 0).getTime();

  it("says the clock today, then yesterday, the weekday, the date and the year", () => {
    const today = new Date(2026, 10, 25, 8, 5).getTime();
    expect(formatTime(today, now)).toBe(clockTime(today));
    expect(formatTime(new Date(2026, 10, 24, 23, 59).getTime(), now)).toBe("昨天");
    expect(formatTime(new Date(2026, 10, 21, 9, 0).getTime(), now)).toBe("星期六");
    expect(formatTime(new Date(2026, 10, 2, 9, 0).getTime(), now)).toBe("11月2日");
    expect(formatTime(new Date(2025, 9, 2, 9, 0).getTime(), now)).toBe("2025/10/2");
  });

  it("points the list's calls of the clock at the list's clock, keeping every line where it was", () => {
    const sidebar = 'import { formatTime } from "@/state/store";\nconst a = formatTime(last.at);\nconst b = <span>{formatTime(last.at)}</span>;\n';
    const compiled = listClockSource(sidebar)!;
    expect(compiled.split("\n").slice(0, 4)).toEqual(['import { formatTime } from "@/state/store";', "const a = suyuanListTime(last.at);", "const b = <span>{suyuanListTime(last.at)}</span>;", ""]);
    expect(compiled).toContain('import { formatTime as suyuanListTime } from "@/suyuan/list-clock";');
    expect(listClockSource("const nothing = 1;")).toBeNull();
  });
});
