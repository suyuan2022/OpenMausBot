// suyuan fork: what Web Push needs from the open app. Its worker is registered, a tapped notification opens its chat
// (a running page gets a message from the worker, a fresh one ?pushBot=&pushThread=), and while push is on here the
// server hears which conversation this device shows, so a reply in it doesn't buzz the phone already open on it.
import { useEffect, useRef, useState } from "react";
import { useShowThreads } from "@/lib/thread-preferences";
import { openThread, type Action, type AppState, type ThreadTarget } from "@/state/store";
import { visibleNotificationThread } from "@/state/thread-navigation";
import { api } from "@/state/api";
import { currentSubscription, PUSH_CHANGED, pushWorker, reportViewing, webPushSupported } from "./web-push";

const HEARTBEAT_MS = 30_000;

function targetInUrl(): ThreadTarget | null {
  const params = new URLSearchParams(location.search);
  const botId = params.get("pushBot"), threadId = params.get("pushThread");
  if (!botId || !threadId) return null;
  params.delete("pushBot");
  params.delete("pushThread");
  const rest = params.toString();
  history.replaceState(history.state, "", `${location.pathname}${rest ? `?${rest}` : ""}${location.hash}`);
  return { botId, threadId };
}

const inFront = () => document.visibilityState === "visible" && document.hasFocus();

export function useWebPush(state: AppState, dispatch: (action: Action) => void): void {
  const [target, setTarget] = useState<ThreadTarget | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [present, setPresent] = useState(inFront);
  const endpointRef = useRef<string | null>(null);
  const showThreads = useShowThreads();

  useEffect(() => {
    if (!webPushSupported()) return;
    const opened = targetInUrl();
    if (opened) setTarget(opened);
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; botId?: unknown; threadId?: unknown } | null;
      if (data?.type === "suyuan-push-open" && typeof data.botId === "string" && typeof data.threadId === "string") {
        setTarget({ botId: data.botId, threadId: data.threadId });
      }
    };
    // Re-sends a held subscription, so a server that lost it (a restored data directory) has it again.
    const refresh = () => void currentSubscription().then((subscription) => {
      endpointRef.current = subscription?.endpoint ?? null;
      setEndpoint(endpointRef.current);
      if (subscription) void api("/api/suyuan/push/subscribe", { method: "POST", body: JSON.stringify(subscription.toJSON()) }).catch(() => {});
    }, () => {});
    navigator.serviceWorker.addEventListener("message", onMessage);
    navigator.serviceWorker.startMessages();
    window.addEventListener(PUSH_CHANGED, refresh);
    void pushWorker().then(refresh, () => {});
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
      window.removeEventListener(PUSH_CHANGED, refresh);
    };
  }, []);

  useEffect(() => {
    const update = () => {
      const now = inFront();
      // Said straight away: iOS may freeze the page before React renders again.
      if (!now && endpointRef.current) reportViewing(endpointRef.current, null, true);
      setPresent(now);
    };
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  useEffect(() => {
    if (!target || !state.hydrated) return;
    setTarget(null);
    openThread(dispatch, target, state, showThreads);
  }, [target, state, showThreads, dispatch]);

  const viewing = endpoint && present ? visibleNotificationThread(state) : null;
  // One report per change: a switch to another chat replaces the last one on the server, so no "nothing" goes between.
  useEffect(() => {
    if (!endpoint) return;
    reportViewing(endpoint, viewing);
    if (!viewing) return;
    const timer = setInterval(() => reportViewing(endpoint, viewing), HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [endpoint, viewing]);
}
