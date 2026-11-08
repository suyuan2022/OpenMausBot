// suyuan fork: what Web Push needs from the open app. Its worker is registered, a tapped notification opens its chat
// (a running page gets a message from the worker, a fresh one ?pushBot=&pushThread=), and while push is on here the
// server hears which conversation this device shows, so a reply in it doesn't buzz the phone already open on it.
import { useEffect, useRef, useState } from "react";
import { useFinishedNotifications, useNotificationSounds } from "@/lib/notification-preferences";
import { useShowThreads } from "@/lib/thread-preferences";
import { openThread, type Action, type AppState, type ThreadTarget } from "@/state/store";
import { visibleNotificationThread } from "@/state/thread-navigation";
import { PUSH_CHANGED, pushWorker, reportViewing, resendSubscription, webPushSupported, workingSubscription } from "./web-push";

/** Well inside the server's VIEWING_MS, so a phone locked without a word stops holding pushes back within seconds. */
const HEARTBEAT_MS = 10_000;

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
    const refresh = () => void workingSubscription().then((subscription) => {
      endpointRef.current = subscription?.endpoint ?? null;
      setEndpoint(endpointRef.current);
    }, () => {});
    // Asked again whenever the app comes back: the server may have been unreachable, or its pushes started failing.
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    navigator.serviceWorker.addEventListener("message", onMessage);
    navigator.serviceWorker.startMessages();
    window.addEventListener(PUSH_CHANGED, refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisible);
    void pushWorker().then(refresh, () => {});
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
      window.removeEventListener(PUSH_CHANGED, refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisible);
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

  // The server drops "done" and silences pushes the way this device's settings already do for its page notifications.
  const finished = useFinishedNotifications(), sounds = useNotificationSounds();
  useEffect(() => {
    if (endpointRef.current) void resendSubscription().catch(() => {});
  }, [finished, sounds]);

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
