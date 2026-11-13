// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { KEPT, appended, beaconAddress, keptLines, line } from "./lifecycle-log";

const KEY = "suyuan:lifecycle-log";
/** Beacons the module sent; happy-dom's own would try to reach a server. Set before the import above runs the module. */
const sent = vi.hoisted(() => {
  const urls: string[] = [];
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: (url: string) => (urls.push(url), true) });
  return urls;
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("lifecycle log", () => {
  it("writes local time to the millisecond, the page and what happened", () => {
    expect(line(new Date(2026, 10, 14, 2, 0, 29, 5).getTime(), "k3x9", "hidden handlers=12ms")).toBe("02:00:29.005 k3x9 hidden handlers=12ms");
  });

  it("keeps the last lines only, and reads nothing from a log it cannot read", () => {
    const full = JSON.stringify(Array.from({ length: KEPT }, (_, n) => `line ${n}`));
    expect(appended(full, "next")).toHaveLength(KEPT);
    expect(appended(full, "next").at(0)).toBe("line 1");
    expect(appended(full, "next").at(-1)).toBe("next");
    expect(keptLines("{")).toEqual([]);
    expect(keptLines('{"a":1}')).toEqual([]);
    expect(keptLines('["a", 2]')).toEqual(["a"]);
  });

  it("puts the lines in the beacon's address, which the relay's access log keeps", () => {
    const address = beaconAddress(["02:00:29.005 k3x9 hidden", "02:06:15.100 p2m4 start"]);
    expect(address.startsWith("/api/suyuan/probe?e=")).toBe(true);
    expect(new URL(address, "https://bot.example").searchParams.get("e")).toBe("02:00:29.005 k3x9 hidden | 02:06:15.100 p2m4 start");
  });

  it("sends the last session's log on start and begins its own", async () => {
    sent.length = 0;
    localStorage.setItem(KEY, JSON.stringify(["02:00:29.005 k3x9 hidden handlers=12ms"]));
    vi.resetModules();
    await import("./lifecycle-log");
    const said = sent.map((url) => new URL(url, "https://bot.example").searchParams.get("e"));
    expect(said[0]).toMatch(/^\w+ last session: \| 02:00:29\.005 k3x9 hidden handlers=12ms$/);
    expect(said[1]).toMatch(/ start visible nav=\S+ standalone=false frame=0$/);
    expect(keptLines(localStorage.getItem(KEY))).toHaveLength(1);
  });
});
