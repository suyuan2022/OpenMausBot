import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../request-auth.ts";
import { PASS } from "../routes/table.ts";
import type { WebPush } from "./web-push.ts";
import { createWebPushRoutes } from "./web-push-routes.ts";

const OWNER: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
const GUEST: RequestAuth = { kind: "loopback", scopes: ["client"], trust: "service" };
const KEYS = { p256dh: Buffer.alloc(65, 4).toString("base64url"), auth: Buffer.alloc(16, 1).toString("base64url") };
const ENDPOINT = "https://web.push.apple.com/QGx3abc";

function fakePush(): WebPush {
  return {
    publicKey: vi.fn(() => "BPUB"),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    viewing: vi.fn(),
    deliver: vi.fn(async () => {}),
    test: vi.fn(async () => ({ ok: true, gone: false, status: "201" })),
  };
}

async function call(path: string, method: string, body: unknown = {}, auth = OWNER) {
  const push = fakePush();
  const answers: Array<[number, unknown]> = [];
  const route = createWebPushRoutes({ push: () => push, isOwner: (who) => who.scopes.includes("admin") });
  const out = await route({
    req: {} as never, res: {} as never, url: new URL(`http://x${path}`), path, method, auth,
    json: ((_res: unknown, status: number, value: unknown) => { answers.push([status, value]); }) as never, readBody: (async () => body) as never,
  });
  return { out, answers, push };
}

describe("/api/suyuan/push", () => {
  it("leaves every other path alone and answers only the owner", async () => {
    expect((await call("/api/suyuan/pushy", "GET")).out).toBe(PASS);
    expect((await call("/api/push", "GET")).out).toBe(PASS);
    expect((await call("/api/suyuan/push", "GET", {}, GUEST)).answers[0]![0]).toBe(403);
    expect((await call("/api/suyuan/push", "GET")).answers).toEqual([[200, { publicKey: "BPUB" }]]);
  });

  it("stores a real subscription and refuses anything else", async () => {
    const good = await call("/api/suyuan/push/subscribe", "POST", { endpoint: ENDPOINT, expirationTime: null, keys: KEYS });
    expect(good.answers).toEqual([[200, { ok: true }]]);
    expect(good.push.subscribe).toHaveBeenCalledWith({ endpoint: ENDPOINT, keys: KEYS });
    const withPrefs = await call("/api/suyuan/push/subscribe", "POST", { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: KEYS, prefs: { done: false, sound: true } });
    expect(withPrefs.push.subscribe).toHaveBeenCalledWith({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: KEYS, prefs: { done: false, sound: true } });
    for (const bad of [
      { endpoint: "https://example.com/push/x", keys: KEYS },
      { endpoint: "https://push.apple.com.evil.test/x", keys: KEYS },
      { endpoint: "http://web.push.apple.com/x", keys: KEYS },
      { endpoint: ENDPOINT, keys: { ...KEYS, auth: "short" } },
      { endpoint: ENDPOINT },
      null,
    ]) {
      const refused = await call("/api/suyuan/push/subscribe", "POST", bad);
      expect(refused.answers[0]![0]).toBe(400);
      expect(refused.push.subscribe).not.toHaveBeenCalled();
    }
  });

  it("passes on what this device shows, dropping a thread id that isn't one", async () => {
    expect((await call("/api/suyuan/push/viewing", "POST", { endpoint: ENDPOINT, threadId: "chief-main" })).push.viewing).toHaveBeenCalledWith(ENDPOINT, "chief-main");
    expect((await call("/api/suyuan/push/viewing", "POST", { endpoint: ENDPOINT, threadId: "../x y" })).push.viewing).toHaveBeenCalledWith(ENDPOINT, null);
    expect((await call("/api/suyuan/push/viewing", "POST", { endpoint: ENDPOINT, threadId: null })).push.viewing).toHaveBeenCalledWith(ENDPOINT, null);
  });

  it("unsubscribes, sends the test push, and names a wrong method or path", async () => {
    expect((await call("/api/suyuan/push/unsubscribe", "POST", { endpoint: ENDPOINT })).push.unsubscribe).toHaveBeenCalledWith(ENDPOINT);
    expect((await call("/api/suyuan/push/test", "POST", { endpoint: ENDPOINT })).answers).toEqual([[200, { ok: true, gone: false, status: "201" }]]);
    expect((await call("/api/suyuan/push/test", "POST", { endpoint: "nope" })).answers[0]![0]).toBe(400);
    expect((await call("/api/suyuan/push/subscribe", "GET")).answers[0]![0]).toBe(405);
    expect((await call("/api/suyuan/push", "POST")).answers[0]![0]).toBe(405);
    expect((await call("/api/suyuan/push/other", "POST")).answers[0]![0]).toBe(404);
  });
});
