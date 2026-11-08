// suyuan fork: this device's Web Push subscription. The server side is server/suyuan/web-push.ts, the worker that shows
// the notifications public/suyuan-push-sw.js.
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

export async function currentSubscription(): Promise<PushSubscription | null> {
  return (await pushWorker()).pushManager.getSubscription();
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

/** Asks for permission first, while the tap that called this still counts as one: iOS only asks from a tap. */
export async function turnOnPush(): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "这个网站的通知被关掉了，到系统设置里打开。" : "没有允许通知。");
  const worker = await pushWorker();
  const { publicKey } = await api<{ publicKey: string }>("/api/suyuan/push");
  const key = keyBytes(publicKey);
  let subscription = await worker.pushManager.getSubscription();
  // A subscription made for another server key (the data directory was replaced) can't be reused.
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api("/api/suyuan/push/subscribe", { method: "POST", body: JSON.stringify(subscription.toJSON()) });
  window.dispatchEvent(new Event(PUSH_CHANGED));
  return subscription;
}

export async function turnOffPush(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await api("/api/suyuan/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => {});
  await subscription.unsubscribe();
  window.dispatchEvent(new Event(PUSH_CHANGED));
}

export function sendTestPush(endpoint: string): Promise<{ ok: boolean }> {
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
