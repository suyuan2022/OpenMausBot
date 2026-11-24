// suyuan fork: shows the server's Web Push notifications (server/suyuan/web-push.ts) and opens their conversation on a
// tap. It only handles push and notificationclick; with no fetch handler it never stands between the app and the network.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }
  // iOS takes push away from a page that receives one without showing it, so every push shows something.
  event.waitUntil(self.registration.showNotification(payload.title || "OpenMausBot", {
    body: payload.body || "",
    tag: payload.tag,
    renotify: Boolean(payload.tag),
    silent: Boolean(payload.silent),
    icon: payload.icon || "/app-icon-192.png",
    data: { botId: payload.botId, threadId: payload.threadId },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { botId, threadId } = event.notification.data || {};
  event.waitUntil((async () => {
    const pages = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const page = pages.find((one) => one.focused) || pages[0];
    if (page) {
      try {
        await page.focus();
        if (botId && threadId) page.postMessage({ type: "suyuan-push-open", botId, threadId });
        return;
      } catch {
        // A page this browser won't bring forward: open a fresh one instead.
      }
    }
    const query = botId && threadId ? `?pushBot=${encodeURIComponent(botId)}&pushThread=${encodeURIComponent(threadId)}` : "";
    await self.clients.openWindow(`/${query}`);
  })());
});
