// suyuan fork: the routes behind the "push to this device" switch in notification settings (server/suyuan/web-push.ts).
//   GET  /api/suyuan/push              { publicKey }
//   POST /api/suyuan/push/subscribe    a PushSubscription's toJSON() plus prefs { done, sound } → { ok, delivering }
//   POST /api/suyuan/push/unsubscribe  { endpoint }
//   POST /api/suyuan/push/viewing      { endpoint, threadId | null }: the conversation this device shows right now
//   POST /api/suyuan/push/test         { endpoint }: one push to that device, so turning it on is proven at once
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";
import type { PushPrefs, PushSubscriptionRecord, WebPush } from "./web-push.ts";

const PREFIX = "/api/suyuan/push";
const THREAD_ID = /^[\w-]{1,100}$/;
/** The push services browsers subscribe with (Chrome and Edge's FCM, Apple, Mozilla, Windows): the server posts to
 * nothing else. */
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/;

function httpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const keyOfLength = (value: unknown, bytes: number) => typeof value === "string" && Buffer.from(value, "base64url").length === bytes;

function prefsOf(value: unknown): PushPrefs | undefined {
  const given = value as { done?: unknown; sound?: unknown } | null;
  return given && typeof given.done === "boolean" && typeof given.sound === "boolean" ? { done: given.done, sound: given.sound } : undefined;
}

export function subscriptionOf(value: unknown): PushSubscriptionRecord | null {
  const given = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; prefs?: unknown } | null;
  if (!given || !httpsUrl(given.endpoint) || !PUSH_HOSTS.test(new URL(given.endpoint).hostname)) return null;
  if (!keyOfLength(given.keys?.p256dh, 65) || !keyOfLength(given.keys?.auth, 16)) return null;
  const prefs = prefsOf(given.prefs);
  return { endpoint: given.endpoint, keys: { p256dh: given.keys!.p256dh as string, auth: given.keys!.auth as string }, ...(prefs ? { prefs } : {}) };
}

export function createWebPushRoutes(deps: { push: () => WebPush; isOwner(auth: RequestAuth): boolean }): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return PASS;
    if (!deps.isOwner(auth)) return json(res, 403, { error: "Only the owner turns push on for a device" });
    const push = deps.push();
    if (path === PREFIX) return method === "GET" ? json(res, 200, { publicKey: push.publicKey() }) : json(res, 405, { error: "GET only" });
    if (method !== "POST") return json(res, 405, { error: "POST only" });
    const body: unknown = await readBody(req, 8192);
    const given = body && typeof body === "object" ? body as Record<string, unknown> : {};
    switch (path.slice(PREFIX.length + 1)) {
      case "subscribe": {
        const subscription = subscriptionOf(given);
        if (!subscription) return json(res, 400, { error: "Not a push subscription: a push service's https endpoint with p256dh and auth keys" });
        return json(res, 200, { ok: true, ...push.subscribe(subscription) });
      }
      case "unsubscribe":
        if (!httpsUrl(given.endpoint)) return json(res, 400, { error: "endpoint must be an https URL" });
        push.unsubscribe(given.endpoint);
        return json(res, 200, { ok: true });
      case "viewing": {
        if (!httpsUrl(given.endpoint)) return json(res, 400, { error: "endpoint must be an https URL" });
        const threadId = typeof given.threadId === "string" && THREAD_ID.test(given.threadId) ? given.threadId : null;
        push.viewing(given.endpoint, threadId);
        return json(res, 200, { ok: true });
      }
      case "test":
        if (!httpsUrl(given.endpoint)) return json(res, 400, { error: "endpoint must be an https URL" });
        return json(res, 200, await push.test(given.endpoint));
      default:
        return json(res, 404, { error: "No such push route" });
    }
  };
}
