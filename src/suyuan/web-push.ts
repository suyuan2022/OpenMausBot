// suyuan fork: this device's Web Push subscription. The server side is server/suyuan/web-push.ts, the worker that shows
// the notifications public/suyuan-push-sw.js.
import { finishedNotificationsEnabled, notificationSoundsEnabled } from "@/lib/notification-preferences";
import { api } from "@/state/api";

const WORKER = "/suyuan-push-sw.js";
/** Fired on window when this device turns push on or off, so the open app starts or stops reporting what it shows. */
export const PUSH_CHANGED = "suyuan-push-changed";

/** The desktop app shows notifications itself, and a Safari tab on iOS has no PushManager until the page is added to
 * the home screen and opened from there. */
export function webPushSupported(): boolean {
  return typeof window !== "undefined" && !window.ogb && "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";
}

/** An iPhone or iPad in a Safari tab: push needs Add to Home Screen first. */
export function needsHomeScreen(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) && (navigator as Navigator & { standalone?: boolean }).standalone !== true;
}

let registering: Promise<ServiceWorkerRegistration> | null = null;
export function pushWorker(): Promise<ServiceWorkerRegistration> {
  registering ??= navigator.serviceWorker.register(WORKER, { scope: "/" });
  return registering;
}

let handledByPush = false;
/** True once this device holds a working push subscription: src/lib/notify.ts then leaves notifications to the worker,
 * so one notification never shows (and sounds) twice. */
export function pushHandlesNotifications(): boolean {
  return handledByPush;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function sameKey(held: ArrayBuffer | null, wanted: Uint8Array): boolean {
  if (!held) return false;
  const bytes = new Uint8Array(held);
  return bytes.length === wanted.length && bytes.every((byte, i) => byte === wanted[i]);
}

const serverKey = async () => keyBytes((await api<{ publicKey: string }>("/api/suyuan/push")).publicKey);

function sendSubscription(subscription: PushSubscription): Promise<unknown> {
  const prefs = { done: finishedNotificationsEnabled(), sound: notificationSoundsEnabled() };
  return api("/api/suyuan/push/subscribe", { method: "POST", body: JSON.stringify({ ...subscription.toJSON(), prefs }) });
}

/** This device's subscription if it still works: made for the server's current key, with permission still granted.
 * One made for another key (the data directory was replaced) is dropped, so the switch shows off instead of lying.
 * The server hears it again, with today's preferences, in case it lost it. */
export async function workingSubscription(): Promise<PushSubscription | null> {
  const subscription = await (await pushWorker()).pushManager.getSubscription();
  let working = subscription !== null && Notification.permission === "granted";
  if (subscription && working && !sameKey(subscription.options.applicationServerKey, await serverKey())) {
    await subscription.unsubscribe().catch(() => {});
    working = false;
  }
  if (subscription && working) await sendSubscription(subscription);
  handledByPush = working;
  return working ? subscription : null;
}

/** Asks for permission first, while the tap that called this still counts as one: iOS only asks from a tap. */
export async function turnOnPush(): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "这个网站的通知被关掉了，到系统设置里打开。" : "没有允许通知。");
  const worker = await pushWorker();
  const key = await serverKey();
  let subscription = await worker.pushManager.getSubscription();
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await sendSubscription(subscription);
  handledByPush = true;
  window.dispatchEvent(new Event(PUSH_CHANGED));
  return subscription;
}

export async function turnOffPush(): Promise<void> {
  const subscription = await (await pushWorker()).pushManager.getSubscription();
  handledByPush = false;
  if (subscription) {
    await api("/api/suyuan/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => {});
    await subscription.unsubscribe();
  }
  window.dispatchEvent(new Event(PUSH_CHANGED));
}

/** Tells the server this device's notification preferences changed. */
export async function resendSubscription(): Promise<void> {
  const subscription = await (await pushWorker()).pushManager.getSubscription();
  if (subscription && handledByPush) await sendSubscription(subscription);
}

export function sendTestPush(endpoint: string): Promise<{ ok: boolean; status: string }> {
  return api("/api/suyuan/push/test", { method: "POST", body: JSON.stringify({ endpoint }) });
}

/** `leaving`: the page is going out of sight, so the request has to outlive it. */
export function reportViewing(endpoint: string, threadId: string | null, leaving = false): void {
  void fetch("/api/suyuan/push/viewing", {
    method: "POST",
    keepalive: leaving,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint, threadId }),
  }).catch(() => {});
}
