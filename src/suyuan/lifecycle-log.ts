// suyuan fork, temporary (FORK.md): hunting the black screen the home-screen app sometimes shows when the person comes back
// from WeChat's voice input. The relay sees no request at all while it is black, so the page is stopped by then and can say
// nothing itself. This keeps a short log of what the page did around going out of sight and coming back in localStorage,
// and every start sends the last session's log along: whether it came back, painted, or was started afresh. Each line also
// goes out as it happens. Both travel as the address of a beacon, which the relay's access log keeps; the server answers
// 404 and keeps nothing. Remove once the cause is found.

const KEY = "suyuan:lifecycle-log";
/** Lines kept: a session's last few trips out and back. */
export const KEPT = 30;
/** No frame drawn this long after a start or a return: the screen is likely still the black the manifest sets. */
export const NO_PAINT_MS = 3_000;
const PATH = "/api/suyuan/probe";

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
  window.addEventListener("visibilitychange", () => { changeAt = performance.now(); }, true);
  window.addEventListener("visibilitychange", () => {
    const handlers = Math.round(performance.now() - changeAt);
    if (document.visibilityState === "hidden") {
      note(`hidden handlers=${handlers}ms nodes=${document.getElementsByTagName("*").length} imgs=${document.images.length}`);
      return;
    }
    note(`visible handlers=${handlers}ms`);
    watchPaint(changeAt, "visible");
  });
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
