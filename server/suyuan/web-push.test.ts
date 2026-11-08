import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Notification } from "../../shared/notification.ts";
import { createWebPush, encryptPushPayload, PAYLOAD_BYTES, PUSH_FILE, pushPayload, TEST_PAYLOAD, VIEWING_MS, vapidAuthorization } from "./web-push.ts";

const b64 = (value: string) => Buffer.from(value, "base64url");

/** What the browser does with a push body: RFC 8291 from the receiving side. */
function decrypt(body: Buffer, receiver: ReturnType<typeof createECDH>, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const idLength = body.readUInt8(20);
  const senderPublic = body.subarray(21, 21 + idLength);
  const sealed = body.subarray(21 + idLength);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), receiver.getPublicKey(), senderPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", receiver.computeSecret(senderPublic), auth, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  const padded = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
  expect(padded.at(-1)).toBe(2);
  return padded.subarray(0, -1).toString("utf8");
}

function device() {
  const receiver = createECDH("prime256v1");
  receiver.generateKeys();
  const auth = Buffer.from("0123456789abcdef");
  return { receiver, auth, endpoint: `https://web.push.apple.com/${Math.random().toString(36).slice(2)}`, keys: { p256dh: receiver.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } };
}

const notification = (threadId: string, kind: Notification["kind"] = "done"): Notification => ({
  kind, botId: "bot-1", botName: "大副", threadId, title: "大副", body: "收工卡写好了", avatarUrl: "/api/bots/bot-1/avatar",
});

const dirs: string[] = [];
function host(fetchAnswer: (url: string) => number = () => 201) {
  const dir = mkdtempSync(join(tmpdir(), "suyuan-push-"));
  dirs.push(dir);
  let now = 1_800_000_000_000;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("", { status: fetchAnswer(url) });
  });
  const log = vi.fn();
  const push = createWebPush({ dataDir: dir, fetch: fetch as never, now: () => now, log });
  return { dir, push, calls, log, advance: (ms: number) => { now += ms; } };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("encryptPushPayload", () => {
  it("matches RFC 8291's worked example byte for byte", () => {
    const expected = b64(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
      "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
      "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
    const body = encryptPushPayload(Buffer.from("When I grow up, I want to be a watermelon"), {
      p256dh: b64("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"),
      auth: b64("BTBZMqHH6r4Tts7J_aSIgg"),
    }, { senderPrivateKey: b64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"), salt: expected.subarray(0, 16) });
    expect(body.toString("base64url")).toBe(expected.toString("base64url"));
  });
});

describe("vapidAuthorization", () => {
  it("signs an ES256 JWT for the push service's origin that the public key verifies", () => {
    const { push, dir } = host();
    const publicKey = push.publicKey();
    const { vapid } = JSON.parse(readFileSync(join(dir, PUSH_FILE), "utf8"));
    const header = vapidAuthorization("https://web.push.apple.com/QGx3abc", vapid, 1_800_000_000_000);
    const [, token, key] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(key).toBe(publicKey);
    const [head, claims, signature] = token!.split(".");
    expect(JSON.parse(b64(claims!).toString())).toEqual({ aud: "https://web.push.apple.com", exp: 1_800_000_000 + 12 * 3600, sub: "https://github.com/suyuan2022/OpenMausBot" });
    const point = b64(publicKey);
    const verifier = createPublicKey({ key: { kty: "EC", crv: "P-256", x: point.subarray(1, 33).toString("base64url"), y: point.subarray(33).toString("base64url") }, format: "jwk" });
    expect(verify("sha256", Buffer.from(`${head}.${claims}`), { key: verifier, dsaEncoding: "ieee-p1363" }, b64(signature!))).toBe(true);
  });
});

describe("createWebPush", () => {
  it("keeps one key pair in a file only its owner reads", () => {
    const first = host();
    const again = createWebPush({ dataDir: first.dir });
    expect(again.publicKey()).toBe(first.push.publicKey());
    expect(b64(first.push.publicKey())).toHaveLength(65);
    expect(statSync(join(first.dir, PUSH_FILE)).mode & 0o777).toBe(0o600);
  });

  it("delivers an encrypted notification each device can read, with the page notification's tag", async () => {
    const { push, calls } = host();
    const phone = device();
    push.subscribe(phone);
    await push.deliver(notification("t1"));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(phone.endpoint);
    expect(calls[0]!.init.headers).toMatchObject({ "content-encoding": "aes128gcm", ttl: "86400", urgency: "high" });
    const payload = JSON.parse(decrypt(Buffer.from(calls[0]!.init.body as Uint8Array), phone.receiver, phone.auth));
    expect(payload).toEqual(pushPayload(notification("t1")));
    expect(payload).toMatchObject({ title: "大副", body: "收工卡写好了", tag: "openmausbot:bot-1", botId: "bot-1", threadId: "t1", icon: "/api/bots/bot-1/avatar" });
    expect(pushPayload(notification("t1", "spend")).tag).toBe("openmausbot:spend");
  });

  it("holds back only the device showing that conversation, until its page stops saying so", async () => {
    const { push, calls, advance } = host();
    const phone = device(), laptop = device();
    push.subscribe(phone);
    push.subscribe(laptop);
    push.viewing(phone.endpoint, "t1");
    await push.deliver(notification("t1"));
    expect(calls.map((call) => call.url)).toEqual([laptop.endpoint]);
    await push.deliver(notification("t2"));
    expect(calls.slice(1).map((call) => call.url).sort()).toEqual([phone.endpoint, laptop.endpoint].sort());
    advance(VIEWING_MS + 1);
    await push.deliver(notification("t1"));
    expect(calls.slice(3)).toHaveLength(2);
    push.viewing(phone.endpoint, "t1");
    push.viewing(phone.endpoint, null);
    await push.deliver(notification("t1"));
    expect(calls.slice(5)).toHaveLength(2);
  });

  it("forgets a device its push service calls gone, and logs any other refusal", async () => {
    const phone = device(), laptop = device();
    const { push, calls, log, dir } = host((url) => (url === phone.endpoint ? 410 : 403));
    push.subscribe(phone);
    push.subscribe(laptop);
    await push.deliver(notification("t1"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("web.push.apple.com answered 403"));
    expect(JSON.parse(readFileSync(join(dir, PUSH_FILE), "utf8")).subscriptions.map((one: { endpoint: string }) => one.endpoint)).toEqual([laptop.endpoint]);
    expect(await push.test(phone.endpoint)).toEqual({ ok: false, gone: false, status: "not subscribed" });
    expect(calls).toHaveLength(2);
  });

  it("sends the test push to just the one device, and replaces a device that subscribes again", async () => {
    const { push, calls, dir } = host();
    const phone = device(), laptop = device();
    push.subscribe(phone);
    push.subscribe(laptop);
    push.subscribe({ ...phone, keys: laptop.keys });
    expect(JSON.parse(readFileSync(join(dir, PUSH_FILE), "utf8")).subscriptions).toHaveLength(2);
    expect(await push.test(laptop.endpoint)).toEqual({ ok: true, gone: false, status: "201" });
    expect(calls.map((call) => call.url)).toEqual([laptop.endpoint]);
    expect(JSON.parse(decrypt(Buffer.from(calls[0]!.init.body as Uint8Array), laptop.receiver, laptop.auth))).toEqual(TEST_PAYLOAD);
    push.unsubscribe(laptop.endpoint);
    expect(await push.test(laptop.endpoint)).toMatchObject({ ok: false, status: "not subscribed" });
  });

  it("drops a subscription whose key is not a point on the curve, and still reaches the other devices", async () => {
    const { push, calls, log, dir } = host();
    const broken = { endpoint: "https://web.push.apple.com/broken", keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64)]).toString("base64url"), auth: Buffer.alloc(16).toString("base64url") } };
    const phone = device();
    push.subscribe(broken);
    push.subscribe(phone);
    await push.deliver(notification("t1"));
    expect(calls.map((call) => call.url)).toEqual([phone.endpoint]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("dropped a subscription whose key is unusable"));
    expect(JSON.parse(readFileSync(join(dir, PUSH_FILE), "utf8")).subscriptions.map((one: { endpoint: string }) => one.endpoint)).toEqual([phone.endpoint]);
  });

  it("follows each device's own settings: no \"done\" when it is off there, no sound when sounds are", async () => {
    const { push, calls } = host();
    const quiet = device(), plain = device();
    push.subscribe({ ...quiet, prefs: { done: false, sound: false } });
    push.subscribe(plain);
    await push.deliver(notification("t1"));
    expect(calls.map((call) => call.url)).toEqual([plain.endpoint]);
    await push.deliver(notification("t1", "question"));
    const sent = new Map(calls.slice(1).map((call) => [call.url, Buffer.from(call.init.body as Uint8Array)]));
    expect(JSON.parse(decrypt(sent.get(quiet.endpoint)!, quiet.receiver, quiet.auth))).toMatchObject({ silent: true });
    expect(JSON.parse(decrypt(sent.get(plain.endpoint)!, plain.receiver, plain.auth))).not.toHaveProperty("silent");
  });

  it("pushes a spend warning even to the device showing its chat, and nothing meant for one teammate", async () => {
    const { push, calls } = host();
    const phone = device();
    push.subscribe(phone);
    push.viewing(phone.endpoint, "t1");
    await push.deliver(notification("t1", "spend"));
    expect(calls).toHaveLength(1);
    await push.deliver({ ...notification("t2"), forPerson: "teammate@example.com" });
    expect(calls).toHaveLength(1);
  });

  it("cuts the body by encoded bytes so the push fits the services' 4 KB", () => {
    const long = { ...notification("t1"), body: `${"汉".repeat(2000)}\u001b[31m`.repeat(2) };
    const payload = pushPayload(long);
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThanOrEqual(PAYLOAD_BYTES);
    expect(payload.body.endsWith("…")).toBe(true);
    expect(payload.body.length).toBeGreaterThan(500);
  });

  it("keeps a key file it can't read rather than replacing the keys every device subscribed with", async () => {
    const { dir, log } = host();
    writeFileSync(join(dir, PUSH_FILE), "{ not json");
    const push = createWebPush({ dataDir: dir, log });
    expect(() => push.publicKey()).toThrow();
    await push.deliver(notification("t1"));
    expect(readFileSync(join(dir, PUSH_FILE), "utf8")).toBe("{ not json");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("could not push"));
  });

  it("never rejects, even when the push service can't be reached", async () => {
    const { push, log } = host();
    push.subscribe(device());
    const failing = createWebPush({ dataDir: dirs[0]!, fetch: (async () => { throw new Error("ECONNRESET"); }) as never, log });
    await expect(failing.deliver(notification("t1"))).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("ECONNRESET"));
  });
});
