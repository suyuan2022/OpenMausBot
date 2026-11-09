// suyuan fork: an idle conversation is summarized only once the person has left, still inside the hour-long cache.
import { describe, expect, it } from "vitest";

import { createWarmSummary, type WarmSummaryDeps, type WarmSummaryTarget } from "./warm-summary.ts";

const MINUTE = 60_000;
const target: WarmSummaryTarget = { threadId: "t1", botId: "b1", instanceId: "claude" };

function setup(hold: WarmSummaryDeps["hold"] = () => null) {
  let now = 0;
  const timers: Array<{ at: number; fn: () => void; cancelled: boolean }> = [];
  const runsAt: number[] = [];
  const warm = createWarmSummary({
    now: () => now,
    after: (ms, fn) => {
      const timer = { at: now + ms, fn, cancelled: false };
      timers.push(timer);
      return { cancel: () => { timer.cancelled = true; } };
    },
    plan: () => ({ way: "native", soon: false }),
    hold,
    run: async () => { runsAt.push(now); return { ok: true }; },
  });
  const advanceTo = async (minute: number) => {
    for (;;) {
      const next = timers.filter((t) => !t.cancelled && t.at <= minute * MINUTE).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      now = next.at;
      next.cancelled = true;
      next.fn();
      await new Promise((resolve) => setImmediate(resolve));
    }
    now = minute * MINUTE;
  };
  return { warm, runsAt, advanceTo };
}

describe("when an idle conversation is summarized", () => {
  it("waits 55 minutes after the turn, not a few", async () => {
    const f = setup();
    f.warm.turnCompleted(target, { ok: true, contextTokens: 150_000 });
    await f.advanceTo(54);
    expect(f.runsAt).toEqual([]);
    await f.advanceTo(55);
    expect(f.runsAt).toEqual([55 * MINUTE]);
  });

  it("looks again once while the bot is busy, and gives up before the cache goes cold at the hour", async () => {
    let busy = true;
    const f = setup(() => (busy ? { reason: "the bot is busy", retry: true } : null));
    f.warm.turnCompleted(target, { ok: true, contextTokens: 150_000 });
    await f.advanceTo(56);
    busy = false;
    await f.advanceTo(57);
    expect(f.runsAt).toEqual([57 * MINUTE]);

    const stuck = setup(() => ({ reason: "the bot is busy", retry: true }));
    stuck.warm.turnCompleted(target, { ok: true, contextTokens: 150_000 });
    await stuck.advanceTo(120);
    expect(stuck.runsAt).toEqual([]);
    expect(stuck.warm.state("t1")?.last).toEqual({ at: 57 * MINUTE, outcome: "skipped: the bot is busy" });
  });
});
