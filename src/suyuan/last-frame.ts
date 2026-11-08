// suyuan fork: the app reopens on the screen it was left on. A home-screen web app that iOS dropped in the background
// otherwise starts on "Connecting to your bots…" until the bots load, a second or more over the relay. When the app goes
// out of sight its markup is kept in localStorage; the next start lays that over the page, inert, and lifts it once the
// bots have loaded. quiet-start.css holds the page's own connecting line back for the first seconds.
import "./quiet-start.css";

const KEY = "suyuan:last-frame";
/** localStorage holds about 5 MB per site; a bigger frame is not kept. */
const MAX_CHARS = 1_500_000;
/** Older than this, the frame would show a screen the person no longer expects. */
const MAX_AGE_MS = 3 * 24 * 3600_000;
/** Bots still not loaded by then: the live page, with its connecting line, takes over. */
export const HOLD_MS = 6_000;
const SCROLL = "data-suyuan-scroll";
/** Same as src/main.tsx: these pages are not the app, so they neither show nor keep a frame. */
const PAGES_WITHOUT_THE_APP = new Set(["/home", "/pair", "/desktop-viewer"]);

export interface Frame {
  html: string;
  width: number;
  height: number;
  at: number;
}

/** The app's markup, with each scrolled element's offset written onto it so the copy opens scrolled the same way. */
export function captureFrame(root: HTMLElement, view: { width: number; height: number }, at: number): Frame {
  const scrolled = [...root.querySelectorAll<HTMLElement>("*")].filter((element) => element.scrollTop > 0);
  for (const element of scrolled) element.setAttribute(SCROLL, String(Math.round(element.scrollTop)));
  try {
    return { html: root.innerHTML, ...view, at };
  } finally {
    for (const element of scrolled) element.removeAttribute(SCROLL);
  }
}

/** A kept frame worth showing: recent, and taken at this window size, so it lines up with the page that replaces it. */
export function usableFrame(text: string | null, view: { width: number; height: number }, now: number): Frame | null {
  if (!text) return null;
  try {
    const frame = JSON.parse(text) as Partial<Frame>;
    if (typeof frame.html !== "string" || typeof frame.at !== "number" || now - frame.at > MAX_AGE_MS) return null;
    return frame.width === view.width && frame.height === view.height ? frame as Frame : null;
  } catch {
    return null;
  }
}

/** Lays the frame over the page. The cover takes taps and its copy none: a tap on a frozen button would land on the
 * half-loaded page underneath. Whatever could run or claim an id is left out of the copy. */
export function showFrame(doc: Document, frame: Frame): HTMLElement {
  const cover = doc.createElement("div");
  cover.id = "suyuan-last-frame";
  cover.setAttribute("aria-hidden", "true");
  cover.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:var(--color-app);"
    + "padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
  const copy = doc.createElement("div");
  copy.inert = true;
  copy.style.height = "100%";
  const template = doc.createElement("template");
  template.innerHTML = frame.html;
  for (const element of template.content.querySelectorAll("script, iframe, object, embed")) element.remove();
  for (const element of template.content.querySelectorAll("*")) {
    for (const name of element.getAttributeNames()) if (name === "id" || name.startsWith("on")) element.removeAttribute(name);
  }
  copy.append(template.content);
  cover.append(copy);
  doc.body.append(cover);
  for (const element of cover.querySelectorAll<HTMLElement>(`[${SCROLL}]`)) {
    element.scrollTop = Number(element.getAttribute(SCROLL));
    element.removeAttribute(SCROLL);
  }
  return cover;
}

let appShown = false;
let appLoaded = false;
let lift = () => {};

function viewSize() {
  return { width: window.innerWidth, height: window.innerHeight };
}

function keep() {
  const root = document.getElementById("root");
  if (!appShown || !appLoaded || !root) return;
  try {
    const frame = captureFrame(root, viewSize(), Date.now());
    if (frame.html.length > MAX_CHARS) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(frame));
  } catch {
    // Storage full or off: the next start just opens the usual way.
  }
}

function start() {
  if (PAGES_WITHOUT_THE_APP.has(location.pathname)) return;
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") keep(); });
  window.addEventListener("pagehide", keep);
  let text: string | null = null;
  try {
    text = localStorage.getItem(KEY);
  } catch {
    return;
  }
  const frame = usableFrame(text, viewSize(), Date.now());
  const root = document.getElementById("root");
  if (!frame || !root) return;
  const cover = showFrame(document, frame);
  const timer = setTimeout(() => lift(), HOLD_MS);
  // The first thing drawn into #root is not the app (the pairing page after a session ended, an error): the frame
  // is someone's chats that this page should not show again.
  const watcher = new MutationObserver(() => {
    if (appShown) return watcher.disconnect();
    lift();
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Nothing kept to forget.
    }
  });
  watcher.observe(root, { childList: true });
  lift = () => {
    lift = () => {};
    clearTimeout(timer);
    watcher.disconnect();
    cover.remove();
  };
}

/** Called from the app's shell on every render: `loaded` once the bots have loaded. */
export function noteApp(loaded: boolean): void {
  appShown = true;
  appLoaded = loaded;
}

/** The app's shell went away (the session ended): a later start must not keep what replaced it. */
export function noteAppGone(): void {
  appShown = false;
}

/** The live page is ready under the cover: take the cover away. */
export function liftFrame(): void {
  lift();
}

if (typeof document !== "undefined" && typeof window !== "undefined") start();
