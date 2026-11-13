// suyuan fork: the app reopens on the screen it was left on. A home-screen web app or Safari tab that iOS dropped in the background
// otherwise starts on "Connecting to your bots…" until the bots load, a second or more over the relay. When the app goes
// out of sight its markup is kept in localStorage; the next start lays that over the page, inert, and lifts it once the
// bots have loaded. quiet-start.css holds the page's own connecting line back for the first seconds.
//
// The app reopens on the last chat at its latest messages, scrolled to the end, with no side panel open, and every other
// scroller at its top. The frame shows only that, so lifting it moves nothing on screen; left on anything else (the bot
// list, settings, a team map, an older stretch of a chat), the app keeps no frame.
import { t } from "@/lib/i18n";
import "./quiet-start.css";
import { withoutBackButton } from "./swipe-back";

const KEY = "suyuan:last-frame";
/** Counted on the stored JSON. WebKit charges 2 bytes a character against about 5 MB per site, which upstream's drafts
 * share, so a bigger frame is not kept. */
const MAX_CHARS = 500_000;
/** Older than this, the frame would show a screen the person no longer expects. */
const MAX_AGE_MS = 3 * 24 * 3600_000;
/** Bots still not loaded by then: the live page takes over, its connecting line usually showing by then. The same wait as the
 * reconnecting strip (src/components/LiveConnectionStrip.tsx), so a frozen screen never passes for a live one longer. */
export const HOLD_MS = 4_000;
/** The lifted frame fades rather than vanishes, so whatever arrived meanwhile (a new message) does not jump in. */
export const FADE_MS = 150;
/** Chat rows wholly further above the end than this many screens never show in the copy, which opens at the end. */
const SCREENS_KEPT = 2;
/** On the chat's scroller: the copy opens at the end, as the app does. */
const AT_END = "data-suyuan-end";
const OUT_OF_SIGHT = "data-suyuan-out-of-sight";
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

/** The "Show later messages (N more)" button a chat opened around an older message (a pin, a search hit) ends in. */
function showsLater(button: Element): boolean {
  const [before, after] = t("chat.showLater", { count: "\u0000" }).split("\u0000");
  const text = button.textContent ?? "";
  return text.length > before.length + after.length && text.startsWith(before) && text.endsWith(after);
}

/** The scroller of the chat shown mid-screen at its latest messages, or null when the screen shows something else. The
 * transcripts are the `role="log"` in src/components/ChatView.tsx and GroupView.tsx. */
export function chatInView(doc: Document, view: { width: number; height: number }): HTMLElement | null {
  const hit = doc.elementFromPoint(view.width / 2, view.height / 2);
  const log = hit?.closest('[role="log"]') ?? hit?.querySelector(':scope > [role="log"]');
  if (!log || [...log.querySelectorAll("button")].some(showsLater)) return null;
  for (let element = log.parentElement; element; element = element.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(element).overflowY)) return element;
  }
  return null;
}

/** Where an element ends on the page. The chat's rows are `display: contents` wrappers, drawn only through their
 * children; one drawing nothing ends nowhere. */
function bottomOf(element: Element): number {
  if (element.getClientRects().length > 0) return element.getBoundingClientRect().bottom;
  return Math.max(-Infinity, ...[...element.children].map(bottomOf));
}

/** The app's markup, cleaned, the chat marked to open at its end without the rows it never shows there. The
 * jump-to-latest button goes: at the end the app does not show it. */
export function captureFrame(root: HTMLElement, chat: HTMLElement, view: { width: number; height: number }, at: number, build: string): Frame {
  const contentTop = chat.getBoundingClientRect().top - chat.scrollTop;
  const keptFrom = chat.scrollHeight - SCREENS_KEPT * chat.clientHeight;
  const rows = [...(chat.querySelector('[role="log"]')?.children ?? [])];
  const unseen = rows.filter((row) => bottomOf(row) - contentTop < keptFrom);
  for (const row of unseen) row.setAttribute(OUT_OF_SIGHT, "");
  chat.setAttribute(AT_END, "");
  try {
    const template = cleanMarkup(root.ownerDocument, root.innerHTML);
    for (const row of template.content.querySelectorAll(`[${OUT_OF_SIGHT}]`)) row.remove();
    withoutBackButton(template.content);
    const latest = t("chat.jumpToLatest");
    for (const button of template.content.querySelectorAll("button[title]")) {
      if (button.getAttribute("title") === latest) button.remove();
    }
    return { html: template.innerHTML, ...view, at, build };
  } finally {
    for (const row of unseen) row.removeAttribute(OUT_OF_SIGHT);
    chat.removeAttribute(AT_END);
  }
}

/** A kept frame worth showing: recent, from this build, and taken at this window width, so its lines wrap as the page's
 * that replaces it. The height may differ: Safari's toolbar shows and hides, and the copy lays out at the window it opens
 * in, its chat at the end, as the app's does. */
export function usableFrame(text: string | null, view: { width: number; height: number }, now: number, build: string): Frame | null {
  if (!text) return null;
  try {
    const frame = JSON.parse(text) as Partial<Frame>;
    if (typeof frame.html !== "string" || typeof frame.at !== "number" || now - frame.at > MAX_AGE_MS || frame.build !== build) return null;
    return frame.width === view.width ? frame as Frame : null;
  } catch {
    return null;
  }
}

/** Lays the frame over the page, its chat at the end. The cover takes taps and its copy none: a tap on a frozen button
 * would land on the half-loaded page underneath. */
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
  for (const chat of cover.querySelectorAll<HTMLElement>(`[${AT_END}]`)) chat.scrollTop = chat.scrollHeight;
  return cover;
}

let appShown = false;
let appLoaded = false;
let appChatAlone = false;
let lift = (_now?: boolean) => {};

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
  // Left on a screen the app does not reopen on: an older frame would show yet another one.
  const chat = appChatAlone ? chatInView(document, viewSize()) : null;
  if (!chat) return forget();
  try {
    const text = JSON.stringify(captureFrame(root, chat, viewSize(), Date.now(), currentBuild()));
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
  // Opened from a notification (public/suyuan-push-sw.js): the app goes to that conversation, not the last one.
  if (new URLSearchParams(location.search).has("pushThread")) return;
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
  // Fonts and pictures arriving under the frame make its chat taller: it stays at the end, as the app's own does.
  const chats = [...cover.querySelectorAll<HTMLElement>(`[${AT_END}]`)];
  const pin = typeof ResizeObserver === "function"
    ? new ResizeObserver(() => { for (const chat of chats) chat.scrollTop = chat.scrollHeight; })
    : null;
  for (const chat of chats) for (const child of chat.children) pin?.observe(child);
  const timer = setTimeout(() => lift(), HOLD_MS);
  // The first thing drawn into #root is not the app (the pairing page, an error): the frame is chats this page
  // should not show again, not even fading.
  const watcher = new MutationObserver(() => {
    if (appShown) return watcher.disconnect();
    lift(true);
    forget();
  });
  watcher.observe(root, { childList: true });
  lift = (now = false) => {
    lift = () => {};
    clearTimeout(timer);
    watcher.disconnect();
    pin?.disconnect();
    if (now) return cover.remove();
    cover.style.pointerEvents = "none";
    cover.style.transition = `opacity ${FADE_MS}ms ease-out`;
    cover.style.opacity = "0";
    setTimeout(() => cover.remove(), FADE_MS);
  };
}

/** The app's shell is on the page: `loaded` once the bots have loaded, `chatAlone` while it shows a chat and no side
 * panel the app would reopen without. */
export function noteApp(loaded: boolean, chatAlone: boolean): void {
  appShown = true;
  appLoaded = loaded;
  appChatAlone = chatAlone;
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
