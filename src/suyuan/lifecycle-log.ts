// suyuan fork, temporary (FORK.md): kept a short log of what the page did around going out of sight and coming back, to
// hunt the black screen the home-screen app showed after WeChat's voice input. The cause was found on 11/16 in the phone's
// own log, and it is not in the page: WeChat's keyboard asks iOS to reopen the app that drew the page for the web app
// (SafariViewService) instead of the web app, and iOS shows that app's own empty window. The page sits in the background
// meanwhile, which is why the relay saw no request while it was black.
// The log stays for now because it also notes, on every return and every change of the keyboard, how far iOS has pushed the
// page and how much of it shows: the numbers that tell whether ./keyboard-fit.ts holds on the phone. Remove after that.
// It lives in localStorage, and every start sends the last session's log along. Each line also goes out as it happens. Both
// travel as the address of a beacon, which the relay's access log keeps; the server answers 404 and keeps nothing.
// It also notes where the open chat sits, and where a chat opened from the list settles.

const KEY = "suyuan:lifecycle-log";
/** Lines kept: a session's last few trips out and back. */
export const KEPT = 30;
/** No frame drawn this long after a start or a return: the screen is likely still the black the manifest sets. */
export const NO_PAINT_MS = 3_000;
const PATH = "/api/suyuan/probe";
/** A second look at the screen after a return, once iOS has surely put the app back. */
const LATER_MS = 1_500;
/** The open chat's scroller (src/components/ChatView.tsx). */
const CHAT = "main .glass-scroller";

/** "02:00:29.512 k3x9 hidden handlers=12ms": local time, the page's id, what happened. */
export function line(at: number, page: string, what: string): string {
  const time = new Date(at);
  return `${time.toTimeString().slice(0, 8)}.${String(time.getMilliseconds()).padStart(3, "0")} ${page} ${what}`;
}

/** The lines in a kept log; none from a log this module cannot read. */
export function keptLines(kept: string | null): string[] {
  try {
    const lines: unknown = JSON.parse(kept ?? "[]");
    return Array.isArray(lines) ? lines.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

/** The kept log with one more line, the oldest dropped past `KEPT`. */
export function appended(kept: string | null, next: string): string[] {
  return [...keptLines(kept), next].slice(-KEPT);
}

/** An element in a few characters: its tag, id and first data attribute. */
export function brief(element: Element | null): string {
  if (!element) return "none";
  const data = [...element.attributes].find((attribute) => attribute.name.startsWith("data-"))?.name;
  return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${data ? `[${data}]` : ""}`;
}

/** What is on screen: how far the page is scrolled, the window and its visible part (the keyboard takes from it), whether the
 * page has focus and on what, and what sits in the middle of the screen. */
export function scene(win: Window): string {
  const doc = win.document;
  const view = win.visualViewport;
  const visible = view ? `vv=${Math.round(view.width)}x${Math.round(view.height)}+${Math.round(view.offsetTop)} scale=${view.scale.toFixed(2)}` : "vv=none";
  const middle = doc.elementFromPoint(win.innerWidth / 2, win.innerHeight / 2);
  return `scroll=${Math.round(win.scrollY)} inner=${win.innerWidth}x${win.innerHeight} doc=${doc.documentElement.clientHeight}/${doc.documentElement.scrollHeight} ${visible} focus=${doc.hasFocus()} active=${brief(doc.activeElement)} middle=${brief(middle)} ${chatAt(doc)}`;
}

/** Where the open chat sits: how far down it is scrolled, and how far that is from its end ("chat=6705/0" is at the end). */
export function chatAt(doc: Document): string {
  const chat = doc.querySelector<HTMLElement>(CHAT);
  return chat ? `chat=${Math.round(chat.scrollTop)}/${Math.round(chat.scrollHeight - chat.scrollTop - chat.clientHeight)}` : "chat=none";
}

export function beaconAddress(lines: string[]): string {
  return `${PATH}?${new URLSearchParams({ e: lines.join(" | ") })}`;
}

function send(lines: string[]) {
  try {
    navigator.sendBeacon(beaconAddress(lines));
  } catch {
    // No beacon: the kept log still goes out on the next start.
  }
}

function start() {
  const page = Math.random().toString(36).slice(2, 6);
  const began = performance.now();
  const note = (what: string, live = true) => {
    const next = line(Date.now(), page, what);
    try {
      localStorage.setItem(KEY, JSON.stringify(appended(localStorage.getItem(KEY), next)));
    } catch {
      // Storage full or off: the live line is all there is.
    }
    if (live) send([next]);
  };
  /** The next frame after `from`, or a note that none came. Two frames: the first runs before the paint it schedules. */
  const watchPaint = (from: number, label: string) => {
    let painted = false;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      painted = true;
      note(`${label} painted +${Math.round(performance.now() - from)}ms`);
    }));
    setTimeout(() => { if (!painted) note(`${label} no paint after ${NO_PAINT_MS}ms`); }, NO_PAINT_MS);
  };

  // The last session's log goes out once and this session starts its own.
  try {
    const earlier = keptLines(localStorage.getItem(KEY));
    if (earlier.length) send([`${page} last session:`, ...earlier]);
    localStorage.removeItem(KEY);
  } catch {
    // Nothing kept.
  }

  const navigation = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
  let frameChars = 0;
  try {
    frameChars = localStorage.getItem("suyuan:last-frame")?.length ?? 0;
  } catch {
    // No frame kept.
  }
  const standalone = matchMedia("(display-mode: standalone)").matches;
  note(`start ${document.visibilityState} nav=${navigation?.type ?? "?"} standalone=${standalone} frame=${frameChars}`);
  watchPaint(began, "start");

  // Window listeners in the capture phase run before the page's own on the document, those in the bubble phase after:
  // the gap is what the page did on that change, src/suyuan/last-frame.ts copying the screen among it.
  let changeAt = 0;
  /** When the page last came back in sight, until its first touch. */
  let backAt: number | null = null;
  window.addEventListener("visibilitychange", () => { changeAt = performance.now(); }, true);
  window.addEventListener("visibilitychange", () => {
    const handlers = Math.round(performance.now() - changeAt);
    if (document.visibilityState === "hidden") {
      note(`hidden handlers=${handlers}ms nodes=${document.getElementsByTagName("*").length} imgs=${document.images.length} ${scene(window)}`);
      backAt = null;
      return;
    }
    note(`visible handlers=${handlers}ms ${scene(window)}`);
    watchPaint(changeAt, "visible");
    backAt = changeAt;
    setTimeout(() => { if (document.visibilityState === "visible") note(`visible later ${scene(window)}`); }, LATER_MS);
  });
  // The keyboard rising after a return is when the screen went black (11/15 00:29): how the screen settled each time.
  let returnedAt = -Infinity;
  let settling: ReturnType<typeof setTimeout> | undefined;
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") returnedAt = Date.now(); });
  window.visualViewport?.addEventListener("resize", () => {
    if (Date.now() - returnedAt > 10_000) return;
    clearTimeout(settling);
    settling = setTimeout(() => note(`resized ${scene(window)}`), 400);
  });
  // 11/15: a chat opened from the list sometimes shows an older stretch, not its end. Where it settled, a moment after.
  window.addEventListener("click", (event) => {
    const row = event.target instanceof Element ? event.target.closest("[data-sidebar-bot-row]") : null;
    if (row) setTimeout(() => note(`row opened ${chatAt(document)}`), LATER_MS);
  }, true);
  window.addEventListener("pointerdown", (event) => {
    if (backAt === null) return;
    note(`touch +${Math.round(performance.now() - backAt)}ms at ${Math.round(event.clientX)},${Math.round(event.clientY)} on ${brief(event.target instanceof Element ? event.target : null)}`);
    backAt = null;
  }, true);
  window.addEventListener("pagehide", (event) => note(`pagehide persisted=${event.persisted}`));
  window.addEventListener("pageshow", (event) => { if (event.persisted) note("pageshow persisted"); });
  window.addEventListener("focus", () => note("focus", false));
  window.addEventListener("blur", () => note("blur", false));
  window.addEventListener("error", (event) => note(`error ${String(event.message).slice(0, 80)}`));
  window.addEventListener("unhandledrejection", (event) => note(`rejection ${String(event.reason).slice(0, 80)}`));

  // When the reopen cover goes and the app first draws, measured from the start.
  const since = () => `+${Math.round(performance.now() - began)}ms`;
  let coverSeen = false;
  const watcher = new MutationObserver(() => {
    if (!coverSeen && document.getElementById("suyuan-last-frame")) {
      coverSeen = true;
      note(`cover shown ${since()}`);
    } else if (coverSeen && !document.getElementById("suyuan-last-frame")) {
      note(`cover gone ${since()}`);
      watcher.disconnect();
    }
  });
  watcher.observe(document.body, { childList: true });
  setTimeout(() => watcher.disconnect(), 30_000);
  const root = document.getElementById("root");
  if (root) {
    const drawn = new MutationObserver(() => {
      drawn.disconnect();
      note(`root drawn ${since()}`);
    });
    drawn.observe(root, { childList: true });
  }
}

if (typeof document !== "undefined" && typeof window !== "undefined" && typeof localStorage !== "undefined") start();
