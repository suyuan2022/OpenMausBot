// suyuan fork: a conversation keep-warm holds is not summarized while idle, unless its next turn would summarize anyway.
import { describe, expect, it, vi } from "vitest";

import type { Message } from "../store.ts";
import { WARM_SUMMARY_IDLE_MS, WARM_SUMMARY_SOON_MS } from "../warm-summary.ts";
import { createWarmSummaryHost, type WarmSummaryHostDeps } from "./warm-summary-host.ts";

function setup(keepWarmUntil: number | undefined) {
  let now = 1_000_000;
  const timers: Array<{ at: number; fn: () => void; cancelled: boolean }> = [];
  const task = { threadId: "t1", resumeCursors: { claude: "live-session" } as Record<string, unknown>, lastInstanceId: "claude", handedMessages: {} };
  const compact = vi.fn(async () => ({ ok: false as const, reason: "stopped here: only whether it was asked matters" }));
  const host = createWarmSummaryHost({
    store: {
      taskByThread: (botId: string, threadId: string) => (botId === "b1" && threadId === "t1" ? task : undefined),
      botByThread: () => ({ id: "b1" }),
      groupByThread: () => undefined,
      activePath: () => [] as Message[],
      appendMessage: () => undefined,
      setResumeCursor: () => undefined,
      setHandedMessages: () => undefined,
    } as unknown as WarmSummaryHostDeps["store"],
    instance: () => ({ adapter: { cacheKeepWarm: { compact, hold: () => true } } }),
    enabled: () => true,
    nativeCompactAt: () => 333_000,
    busy: () => false,
    memoryShort: () => false,
    queued: () => false,
    coordinator: { activeDirect: () => false, awaitingTeammateThreads: () => new Set() },
    waits: () => ({ all: () => [] }),
    routines: () => ({ listRoutines: () => [], listRuns: () => [] }),
    fold: async () => false,
    book: () => undefined,
    keepWarmUntil: () => keepWarmUntil,
    now: () => now,
    after: (ms, fn) => {
      const timer = { at: now + ms, fn, cancelled: false };
      timers.push(timer);
      return { cancel: () => { timer.cancelled = true; } };
    },
  });
  const advance = async (ms: number) => {
    const until = now + ms;
    for (;;) {
      const next = timers.filter((t) => !t.cancelled && t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      now = next.at;
      next.cancelled = true;
      next.fn();
      for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
    }
    now = until;
  };
  const finishTurn = (contextTokens: number) => host.turnCompleted({ threadId: "t1", botId: "b1", instanceId: "claude" }, { ok: true, contextTokens });
  return { compact, advance, finishTurn, now: () => now };
}

describe("warm summaries and keep-warm", () => {
  it("leaves a conversation keep-warm holds whole while it is idle", async () => {
    const f = setup(1_000_000 + 3 * 60 * 60_000);
    f.finishTurn(150_000);
    await f.advance(2 * WARM_SUMMARY_IDLE_MS);
    expect(f.compact).not.toHaveBeenCalled();
  });

  it("still summarizes one whose next turn would summarize anyway", async () => {
    const f = setup(1_000_000 + 3 * 60 * 60_000);
    f.finishTurn(300_000);
    await f.advance(WARM_SUMMARY_SOON_MS);
    expect(f.compact).toHaveBeenCalledTimes(1);
  });

  it("summarizes an idle conversation when keep-warm is off", async () => {
    const f = setup(undefined);
    f.finishTurn(150_000);
    await f.advance(WARM_SUMMARY_IDLE_MS);
    expect(f.compact).toHaveBeenCalledTimes(1);
  });
});
