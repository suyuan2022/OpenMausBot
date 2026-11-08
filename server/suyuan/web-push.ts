// suyuan fork: Web Push, so the web app added to a phone's home screen (iOS 16.4+) or a desktop browser shows the
// server's notifications while it is closed. Bodies are encrypted per RFC 8291 and signed per RFC 8292 (VAPID) with
// node:crypto alone, so the fork adds nothing to the lockfile.
import { createCipheriv, createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign, type webcrypto } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Notification } from "../../shared/notification.ts";

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface Vapid {
  /** The uncompressed P-256 point, base64url: what a page passes as applicationServerKey. */
  publicKey: string;
  privateKey: webcrypto.JsonWebKey;
}

interface PushFile {
  vapid: Vapid;
  subscriptions: PushSubscriptionRecord[];
}

export interface PushPayload {
  title: string;
  body: string;
  /** Same tag as the page's own notifications (src/lib/notify.ts), so the two replace each other instead of stacking. */
  tag: string;
  botId?: string;
  threadId?: string;
  icon?: string;
}

/** How long a device's "I show this conversation" lasts unless its page says it again; a page that went away without a
 * word stops holding pushes back after this. */
export const VIEWING_MS = 75_000;
export const PUSH_FILE = "suyuan-web-push.json";
const SUBJECT = "https://github.com/suyuan2022/OpenMausBot";
const RECORD_SIZE = 4096;

const utf8 = (value: string) => Buffer.from(value, "utf8");

/** One RFC 8291 aes128gcm body. `fixed` pins the sender key and salt, which only the RFC's worked example needs. */
export function encryptPushPayload(
  plaintext: Buffer,
  keys: { p256dh: Buffer; auth: Buffer },
  fixed: { senderPrivateKey?: Buffer; salt?: Buffer } = {},
): Buffer {
  const sender = createECDH("prime256v1");
  if (fixed.senderPrivateKey) sender.setPrivateKey(fixed.senderPrivateKey);
  else sender.generateKeys();
  const senderPublic = sender.getPublicKey();
  const salt = fixed.salt ?? randomBytes(16);
  const keyInfo = Buffer.concat([utf8("WebPush: info\0"), keys.p256dh, senderPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", sender.computeSecret(keys.p256dh), keys.auth, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, utf8("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, utf8("Content-Encoding: nonce\0"), 12));
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // A single record: the content, then the 0x02 delimiter that marks the last one.
  const sealed = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(senderPublic.length, 20);
  return Buffer.concat([header, senderPublic, sealed]);
}

export function vapidAuthorization(endpoint: string, vapid: Vapid, now: number): string {
  const part = (value: object) => utf8(JSON.stringify(value)).toString("base64url");
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: SUBJECT };
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part(claims)}`;
  const key = createPrivateKey({ key: vapid.privateKey, format: "jwk" });
  const signature = sign("sha256", utf8(unsigned), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${unsigned}.${signature.toString("base64url")}, k=${vapid.publicKey}`;
}

function newVapid(): Vapid {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const { x, y } = publicKey.export({ format: "jwk" });
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(x!, "base64url"), Buffer.from(y!, "base64url")]);
  return { publicKey: point.toString("base64url"), privateKey: privateKey.export({ format: "jwk" }) };
}

export function pushPayload(notification: Notification): PushPayload {
  return {
    title: notification.title,
    body: notification.body.slice(0, 1000),
    tag: notification.kind === "spend" ? "openmausbot:spend" : `openmausbot:${notification.botId}`,
    botId: notification.botId,
    threadId: notification.threadId,
    ...(notification.avatarUrl ? { icon: notification.avatarUrl } : {}),
  };
}

export const TEST_PAYLOAD: PushPayload = {
  title: "OpenMausBot",
  body: "推送已开启：bot 回完、提问、要你审批时，这台设备会收到通知。",
  tag: "openmausbot:push-test",
};

export interface WebPush {
  publicKey(): string;
  subscribe(subscription: PushSubscriptionRecord): void;
  unsubscribe(endpoint: string): void;
  /** `threadId` null: this device shows no conversation, or is out of sight. */
  viewing(endpoint: string, threadId: string | null): void;
  /** Every notify frame: each device that turned push on, except one showing that very conversation. Never rejects. */
  deliver(notification: Notification): Promise<void>;
  /** false when that device is not subscribed or its push service said it is gone. */
  test(endpoint: string): Promise<boolean>;
}

export function createWebPush(options: {
  dataDir: string;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
}): WebPush {
  const file = join(options.dataDir, PUSH_FILE);
  const post = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => console.error(`[web-push] ${line}`));
  const viewing = new Map<string, { threadId: string; until: number }>();
  let state: PushFile | undefined;

  const save = (next: PushFile) => {
    state = next;
    writeFileSync(`${file}.tmp`, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  };
  const load = (): PushFile => {
    if (state) return state;
    try {
      state = JSON.parse(readFileSync(file, "utf8")) as PushFile;
    } catch {
      save({ vapid: newVapid(), subscriptions: [] });
    }
    return state!;
  };

  /** false: the push service says this subscription is gone for good. */
  async function pushTo(subscription: PushSubscriptionRecord, payload: PushPayload): Promise<boolean> {
    const host = new URL(subscription.endpoint).host;
    let body: Buffer;
    try {
      body = encryptPushPayload(utf8(JSON.stringify(payload)), {
        p256dh: Buffer.from(subscription.keys.p256dh, "base64url"),
        auth: Buffer.from(subscription.keys.auth, "base64url"),
      });
    } catch (error) {
      // A key no browser would hand out: this device can never be reached, so it is dropped like a gone one.
      log(`${host}: dropped a subscription whose key is unusable (${error instanceof Error ? error.message : String(error)})`);
      return false;
    }
    try {
      const response = await post(subscription.endpoint, {
        method: "POST",
        headers: {
          ttl: "86400",
          urgency: "high",
          "content-encoding": "aes128gcm",
          "content-type": "application/octet-stream",
          authorization: vapidAuthorization(subscription.endpoint, load().vapid, now()),
        },
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 404 || response.status === 410) return false;
      if (!response.ok) log(`${host} answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
    } catch (error) {
      log(`${host}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return true;
  }

  async function pushAll(subscriptions: PushSubscriptionRecord[], payload: PushPayload): Promise<number> {
    const gone = new Set<string>();
    await Promise.all(subscriptions.map(async (subscription) => {
      if (!(await pushTo(subscription, payload))) gone.add(subscription.endpoint);
    }));
    if (gone.size) {
      const current = load();
      save({ ...current, subscriptions: current.subscriptions.filter((one) => !gone.has(one.endpoint)) });
      for (const endpoint of gone) viewing.delete(endpoint);
    }
    return subscriptions.length - gone.size;
  }

  return {
    publicKey: () => load().vapid.publicKey,
    subscribe({ endpoint, keys }) {
      const current = load();
      const kept = current.subscriptions.filter((one) => one.endpoint !== endpoint);
      save({ ...current, subscriptions: [...kept, { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }] });
    },
    unsubscribe(endpoint) {
      const current = load();
      viewing.delete(endpoint);
      save({ ...current, subscriptions: current.subscriptions.filter((one) => one.endpoint !== endpoint) });
    },
    viewing(endpoint, threadId) {
      if (threadId) viewing.set(endpoint, { threadId, until: now() + VIEWING_MS });
      else viewing.delete(endpoint);
    },
    async deliver(notification) {
      try {
        const at = now();
        const targets = load().subscriptions.filter((subscription) => {
          const shown = viewing.get(subscription.endpoint);
          return !(shown && shown.until > at && shown.threadId === notification.threadId);
        });
        if (targets.length) await pushAll(targets, pushPayload(notification));
      } catch (error) {
        log(`could not push "${notification.title}": ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    async test(endpoint) {
      const subscription = load().subscriptions.find((one) => one.endpoint === endpoint);
      return subscription ? (await pushAll([subscription], TEST_PAYLOAD)) === 1 : false;
    },
  };
}

const hosts = new Map<string, WebPush>();

/** The one instance per data directory that server/index.ts hands every notify frame to. */
export function webPushFor(dataDir: string): WebPush {
  let host = hosts.get(dataDir);
  if (!host) hosts.set(dataDir, (host = createWebPush({ dataDir })));
  return host;
}
