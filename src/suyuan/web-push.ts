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
/** True while this device holds a subscription the server says its pushes reach: src/lib/notify.ts then leaves
 * notifications to the worker, so one notification never shows (and sounds) twice. Until the server says so, the page
 * keeps showing its own, so a device whose pushes fail still hears from its bots while open. */
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

/** Hands the server this subscription with today's preferences; true when it says pushes to it get through. */
async function sendSubscription(subscription: PushSubscription): Promise<boolean> {
  const prefs = { done: finishedNotificationsEnabled(), sound: notificationSoundsEnabled() };
  const answer = await api<{ delivering?: boolean }>("/api/suyuan/push/subscribe", { method: "POST", body: JSON.stringify({ ...subscription.toJSON(), prefs }) });
  return answer.delivering !== false;
}

/** This device's subscription while it can still work: permission still granted, made for the server's current key.
 * One made for another key (the data directory was replaced) is dropped, so the switch shows off instead of lying.
 * The server hears it again, in case it lost it. Talking to the server is best effort: while it can't be reached the
 * subscription still counts, so the page goes on reporting what it shows, and it keeps its own notifications. */
export async function workingSubscription(): Promise<PushSubscription | null> {
  const subscription = await (await pushWorker()).pushManager.getSubscription();
  if (!subscription || Notification.permission !== "granted") {
    handledByPush = false;
    return null;
  }
  const key = await serverKey().catch(() => null);
  if (key && !sameKey(subscription.options.applicationServerKey, key)) {
    handledByPush = false;
    await subscription.unsubscribe().catch(() => {});
    return null;
  }
  handledByPush = await sendSubscription(subscription).catch(() => false);
  return subscription;
}

/** Asks for permission first, while the tap that called this still counts as one: iOS only asks from a tap. Ends with
 * one test push, whose answer says whether the page can leave its notifications to push. */
export async function turnOnPush(): Promise<{ ok: boolean; status: string }> {
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
  const test = await api<{ ok: boolean; status: string }>("/api/suyuan/push/test", { method: "POST", body: JSON.stringify({ endpoint: subscription.endpoint }) });
  handledByPush = test.ok;
  window.dispatchEvent(new Event(PUSH_CHANGED));
  return test;
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
  if (subscription && Notification.permission === "granted") handledByPush = await sendSubscription(subscription);
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
