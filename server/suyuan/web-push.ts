// suyuan fork: Web Push, so the web app added to a phone's home screen (iOS 16.4+) or a desktop browser shows the
// server's notifications while it is closed. Bodies are encrypted per RFC 8291 and signed per RFC 8292 (VAPID) with
// node:crypto alone, so the fork adds nothing to the lockfile.
import { createCipheriv, createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign, type webcrypto } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Notification } from "../../shared/notification.ts";

/** The device's own notification settings (src/lib/notification-preferences.ts), which the page's notifications obey. */
export interface PushPrefs {
  /** "Notify me when a bot finishes": off drops the "done" kind. */
  done: boolean;
  /** Notification sounds: off shows the push without a sound. */
  sound: boolean;
}

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  prefs?: PushPrefs;
  /** Whether the last push to it got through; absent before the first. A page keeps showing its own notifications while
   * this is false (src/suyuan/web-push.ts), so a device whose pushes fail still hears from its bots while open. */
  delivered?: boolean;
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
  /** Same tag as the page's own notifications (src/lib/notify.ts). */
  tag: string;
  botId?: string;
  threadId?: string;
  icon?: string;
  silent?: boolean;
}

/** How long a device's "I show this conversation" lasts unless its page says it again (it does every 10 s); a page that
 * went away without a word stops holding pushes back after this. */
export const VIEWING_MS = 25_000;
export const PUSH_FILE = "suyuan-web-push.json";
/** Push services take 4096 bytes of encrypted body, 103 of which the encryption itself uses; this leaves headroom. */
export const PAYLOAD_BYTES = 3000;
const SUBJECT = "https://github.com/suyuan2022/OpenMausBot";
const RECORD_SIZE = 4096;

const utf8 = (value: string) => Buffer.from(value, "utf8");
/** The first `count` characters, never half of an emoji's surrogate pair. */
const firstChars = (text: string, count: number) => Array.from(text).slice(0, count).join("");

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

/** The JSON a device decrypts, cut to PAYLOAD_BYTES by its encoded size, not its length: a CJK character is 3 bytes and a
 * control character in command output 6 once escaped. */
export function pushPayload(notification: Notification, prefs?: PushPrefs): PushPayload {
  const payload: PushPayload = {
    title: firstChars(notification.title, 200),
    body: notification.body,
    tag: notification.kind === "spend" ? "openmausbot:spend" : `openmausbot:${notification.botId}`,
    botId: notification.botId,
    threadId: notification.threadId,
    ...(notification.avatarUrl && notification.avatarUrl.length <= 300 ? { icon: notification.avatarUrl } : {}),
    ...(prefs?.sound === false ? { silent: true } : {}),
  };
  const fits = () => Buffer.byteLength(JSON.stringify(payload)) <= PAYLOAD_BYTES;
  let kept = Array.from(payload.body);
  while (!fits() && kept.length > 0) {
    // At least one character fewer every round, so the loop ends even when the other fields alone are too big.
    kept = kept.slice(0, Math.min(Math.floor(kept.length * 0.8), kept.length - 1));
    payload.body = kept.length ? `${kept.join("")}…` : "";
  }
  // Only the body is meant to run long; a notification whose other fields overflow still shows, just bare.
  return fits() ? payload : { title: "OpenMausBot", body: "", tag: "openmausbot", ...(payload.silent ? { silent: true } : {}) };
}

export const TEST_PAYLOAD: PushPayload = {
  title: "OpenMausBot",
  body: "推送已开启：bot 回完、提问、要你审批时，这台设备会收到通知。",
  tag: "openmausbot:push-test",
};

/** What one push service said: `gone` for a device it no longer knows, `status` its HTTP answer or the network error. */
export interface PushOutcome {
  ok: boolean;
  gone: boolean;
  status: string;
}

export interface WebPush {
  publicKey(): string;
  /** `delivering`: false while the last push to this device failed. */
  subscribe(subscription: PushSubscriptionRecord): { delivering: boolean };
  unsubscribe(endpoint: string): void;
  /** `threadId` null: this device shows no conversation, or is out of sight. */
  viewing(endpoint: string, threadId: string | null): void;
  /** Every notify frame: each device that turned push on and wants this kind, except one showing that very
   * conversation. Never rejects. */
  deliver(notification: Notification): Promise<void>;
  /** One push to that device, to prove turning it on worked; `status` "not subscribed" when the server has no such one. */
  test(endpoint: string): Promise<PushOutcome>;
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
  /** A new key pair only when there is no file yet: any other failure leaves the file alone, since replacing the keys
   * would silently cut off every subscribed device. */
  const load = (): PushFile => {
    if (state) return state;
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      save({ vapid: newVapid(), subscriptions: [] });
      return state!;
    }
    state = JSON.parse(text) as PushFile;
    return state;
  };

  async function pushTo(subscription: PushSubscriptionRecord, payload: PushPayload): Promise<PushOutcome> {
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
      return { ok: false, gone: true, status: "unusable key" };
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
      const gone = response.status === 404 || response.status === 410;
      if (!response.ok && !gone) log(`${host} answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
      return { ok: response.ok, gone, status: String(response.status) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`${host}: ${message}`);
      return { ok: false, gone: false, status: message };
    }
  }

  async function pushAll(sends: Array<{ subscription: PushSubscriptionRecord; payload: PushPayload }>): Promise<PushOutcome[]> {
    const outcomes = await Promise.all(sends.map(({ subscription, payload }) => pushTo(subscription, payload)));
    const gone = new Set(sends.filter((_, i) => outcomes[i]!.gone).map(({ subscription }) => subscription.endpoint));
    const delivered = new Map(sends.map(({ subscription }, i) => [subscription.endpoint, outcomes[i]!.ok]));
    const current = load();
    const subscriptions = current.subscriptions
      .filter((one) => !gone.has(one.endpoint))
      .map((one) => delivered.has(one.endpoint) && one.delivered !== delivered.get(one.endpoint) ? { ...one, delivered: delivered.get(one.endpoint) } : one);
    if (gone.size || subscriptions.some((one, i) => one !== current.subscriptions[i])) save({ ...current, subscriptions });
    for (const endpoint of gone) viewing.delete(endpoint);
    return outcomes;
  }

  return {
    publicKey: () => load().vapid.publicKey,
    subscribe({ endpoint, keys, prefs }) {
      const current = load();
      const before = current.subscriptions.find((one) => one.endpoint === endpoint);
      // The same subscription heard again (every page load does) keeps what its last push did; new keys start over.
      const delivered = before && before.keys.p256dh === keys.p256dh && before.keys.auth === keys.auth ? before.delivered : undefined;
      const record: PushSubscriptionRecord = {
        endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, ...(prefs ? { prefs } : {}), ...(delivered === undefined ? {} : { delivered }),
      };
      save({ ...current, subscriptions: [...current.subscriptions.filter((one) => one !== before), record] });
      return { delivering: delivered !== false };
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
        // Meant for one teammate on a Team Cloud: its routing (teamOwners.reaches) is not repeated here, so none of it.
        if (notification.forPerson) return;
        const at = now();
        const sends = load().subscriptions
          .filter((subscription) => {
            if (notification.kind === "done" && subscription.prefs?.done === false) return false;
            // A spend warning shows on the page even in its own chat (src/lib/notify.ts), so it is never held back.
            if (notification.kind === "spend") return true;
            const shown = viewing.get(subscription.endpoint);
            return !(shown && shown.until > at && shown.threadId === notification.threadId);
          })
          .map((subscription) => ({ subscription, payload: pushPayload(notification, subscription.prefs) }));
        if (sends.length) await pushAll(sends);
      } catch (error) {
        log(`could not push "${notification.title}": ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    async test(endpoint) {
      const subscription = load().subscriptions.find((one) => one.endpoint === endpoint);
      if (!subscription) return { ok: false, gone: false, status: "not subscribed" };
      const payload = subscription.prefs?.sound === false ? { ...TEST_PAYLOAD, silent: true } : TEST_PAYLOAD;
      return (await pushAll([{ subscription, payload }]))[0]!;
    },
  };
}

const hosts = new Map<string, WebPush>();

/** The one instance per data directory that every notify frame reaches (server/suyuan/register.ts). */
export function webPushFor(dataDir: string): WebPush {
  let host = hosts.get(dataDir);
  if (!host) hosts.set(dataDir, (host = createWebPush({ dataDir })));
  return host;
}
