// suyuan fork: the app reopens on the screen it was left on. A home-screen web app that iOS dropped in the background
// otherwise starts on "Connecting to your bots…" until the bots load, a second or more over the relay. When the app goes
// out of sight its markup is kept in localStorage; the next start lays that over the page, inert, and lifts it once the
// bots have loaded. quiet-start.css holds the page's own connecting line back for the first seconds.
import "./quiet-start.css";

const KEY = "suyuan:last-frame";
/** Counted on the stored JSON. WebKit charges 2 bytes a character against about 5 MB per site, which upstream's drafts
 * share, so a bigger frame is not kept. */
const MAX_CHARS = 500_000;
/** Older than this, the frame would show a screen the person no longer expects. */
const MAX_AGE_MS = 3 * 24 * 3600_000;
/** Bots still not loaded by then: the live page takes over, its connecting line usually showing by then. The same wait as the
 * reconnecting strip (src/components/LiveConnectionStrip.tsx), so a frozen screen never passes for a live one longer. */
export const HOLD_MS = 4_000;
const SCROLL = "data-suyuan-scroll";
/** Same as src/main.tsx: these pages are not the app, so they neither show nor keep a frame. */
const PAGES_WITHOUT_THE_APP = new Set(["/home", "/pair", "/desktop-viewer"]);
/** Whatever could run, load or navigate, plus open dialogs, which in a copy would sit in the page without their backdrop. */
const DROPPED = "script, iframe, frame, frameset, fencedframe, object, embed, base, meta, link, noscript, template, dialog";

export interface Frame {
  html: string;
  width: number;
  height: number;
  at: number;
  /** The page's entry script: after a deploy the old markup may use classes the new stylesheet no longer has. */
  build: string;
}

/** Inputs a person types into; sliders, boxes and buttons keep their values, which only say where they stand. */
const TYPED = "input:not([type=range], [type=checkbox], [type=radio], [type=color], [type=button], [type=submit], [type=reset], [type=image])";

/** The copy that may be kept and shown: nothing that could run or load a page, and no typed values (a secret pasted
 * into a password field is in its value attribute). Ids stay inside SVGs, whose gradients, clip paths and Mermaid
 * styles point at them; elsewhere they are dropped. Handed back as nodes, so what is shown is what was checked: parsing
 * the cleaned markup again could build something new. */
export function cleanMarkup(doc: Document, html: string): HTMLTemplateElement {
  const template = doc.createElement("template");
  template.innerHTML = html;
  const content = template.content;
  for (const element of content.querySelectorAll(DROPPED)) element.remove();
  for (const element of content.querySelectorAll("*")) {
    for (const name of element.getAttributeNames()) {
      if (name.startsWith("on") || (name === "id" && !element.closest("svg"))) element.removeAttribute(name);
    }
    // A blob: address dies with the page that made it.
    if (element.getAttribute("src")?.startsWith("blob:")) element.removeAttribute("src");
  }
  for (const input of content.querySelectorAll(TYPED)) input.removeAttribute("value");
  for (const area of content.querySelectorAll("textarea")) area.textContent = "";
  // Pictures wait behind the session, the app's script and the bots on the relay's narrow line.
  for (const image of content.querySelectorAll("img")) image.setAttribute("fetchpriority", "low");
  return template;
}

/** The app's markup, cleaned, with each scrolled element's offset written onto it so the copy opens scrolled the same way. */
export function captureFrame(root: HTMLElement, view: { width: number; height: number }, at: number, build: string): Frame {
  const scrolled = [...root.querySelectorAll<HTMLElement>("*")].filter((element) => element.scrollTop > 0);
  for (const element of scrolled) element.setAttribute(SCROLL, String(Math.round(element.scrollTop)));
  try {
    return { html: cleanMarkup(root.ownerDocument, root.innerHTML).innerHTML, ...view, at, build };
  } finally {
    for (const element of scrolled) element.removeAttribute(SCROLL);
  }
}

/** A kept frame worth showing: recent, from this build, and taken at this window size, so it lines up with the page
 * that replaces it. */
export function usableFrame(text: string | null, view: { width: number; height: number }, now: number, build: string): Frame | null {
  if (!text) return null;
  try {
    const frame = JSON.parse(text) as Partial<Frame>;
    if (typeof frame.html !== "string" || typeof frame.at !== "number" || now - frame.at > MAX_AGE_MS || frame.build !== build) return null;
    return frame.width === view.width && frame.height === view.height ? frame as Frame : null;
  } catch {
    return null;
  }
}

/** Lays the frame over the page. The cover takes taps and its copy none: a tap on a frozen button would land on the
 * half-loaded page underneath. */
export function showFrame(doc: Document, frame: Frame): HTMLElement {
  const cover = doc.createElement("div");
  cover.id = "suyuan-last-frame";
  cover.setAttribute("aria-hidden", "true");
  cover.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:var(--color-app);"
    + "padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
  const copy = doc.createElement("div");
  copy.inert = true;
  copy.style.height = "100%";
  // Cleaned again: what localStorage hands back is only as trustworthy as everything else on this origin.
  copy.append(cleanMarkup(doc, frame.html).content);
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

function currentBuild(): string {
  return document.querySelector('script[type="module"][src]')?.getAttribute("src") ?? "";
}

function forget() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing kept to forget.
  }
}

function keep() {
  const root = document.getElementById("root");
  if (!appShown || !appLoaded || !root) return;
  try {
    const text = JSON.stringify(captureFrame(root, viewSize(), Date.now(), currentBuild()));
    if (text.length > MAX_CHARS) forget();
    else localStorage.setItem(KEY, text);
  } catch {
    // Storage full or off: an older frame must not stand in for this one.
    forget();
  }
}

function start() {
  if (PAGES_WITHOUT_THE_APP.has(location.pathname)) {
    // Pairing again, maybe as someone else: the last session's chats must not cover the next one.
    if (location.pathname === "/pair") forget();
    return;
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") keep(); });
  window.addEventListener("pagehide", keep);
  let text: string | null = null;
  try {
    text = localStorage.getItem(KEY);
  } catch {
    return;
  }
  const frame = usableFrame(text, viewSize(), Date.now(), currentBuild());
  const root = document.getElementById("root");
  if (!frame || !root) return;
  const cover = showFrame(document, frame);
  const timer = setTimeout(() => lift(), HOLD_MS);
  // The first thing drawn into #root is not the app (the pairing page, an error): the frame is chats this page
  // should not show again.
  const watcher = new MutationObserver(() => {
    if (appShown) return watcher.disconnect();
    lift();
    forget();
  });
  watcher.observe(root, { childList: true });
  lift = () => {
    lift = () => {};
    clearTimeout(timer);
    watcher.disconnect();
    cover.remove();
  };
}

/** The app's shell is on the page: `loaded` once the bots have loaded. */
export function noteApp(loaded: boolean): void {
  appShown = true;
  appLoaded = loaded;
}

/** The app's shell went away, which only a session ending or a crash does: the kept frame goes with it. */
export function noteAppGone(): void {
  appShown = false;
  forget();
}

/** The live page is ready under the cover: take the cover away. */
export function liftFrame(): void {
  lift();
}

// After src/main.tsx has run: the skin, font and chat width are set, so the copy lays out and scrolls as the app will,
// and the session and app script are already on their way.
if (typeof document !== "undefined" && typeof window !== "undefined") queueMicrotask(start);
