// suyuan fork (FORK.md): the home-screen app sometimes comes back from another app (WeChat's voice input, most often) to a
// black screen while the page is alive: the recorder (./lifecycle-log.ts) saw it draw a frame 41ms after its return and fetch
// as usual, yet nothing showed until the person swiped the app away and back. iOS then shows none of what the page draws.
// So every return makes WebKit draw the whole page afresh, twice: right away and once more a little later, in case the screen
// was not ready for the first. The page goes a hair translucent for one frame, which WebKit can only show by painting every
// layer again; nothing visibly changes.

/** The second repaint, after the first: long enough for iOS to have put the app back on screen. */
export const AGAIN_MS = 700;
/** Below 1, so WebKit repaints; this close to 1, so nobody sees it. */
const HAIR = "0.999";

type Frame = (callback: () => void) => unknown;

/** Repaints the page once: the root's opacity a hair below 1 for one frame, then back to what it was. */
export function repaint(doc: Document, frame: Frame = requestAnimationFrame) {
  const style = doc.documentElement.style;
  if (style.opacity === HAIR) return;
  const was = style.opacity;
  style.opacity = HAIR;
  // Two frames: the first runs before the paint that shows the change.
  frame(() => frame(() => { style.opacity = was; }));
}

/** Repaints on every return to sight: now, and again after `AGAIN_MS`. */
export function repaintOnReturn(win: Window, frame: Frame = requestAnimationFrame) {
  const doc = win.document;
  const both = () => {
    repaint(doc, frame);
    win.setTimeout(() => repaint(doc, frame), AGAIN_MS);
  };
  doc.addEventListener("visibilitychange", () => { if (doc.visibilityState === "visible") both(); });
  win.addEventListener("pageshow", (event) => { if (event.persisted) both(); });
}

if (typeof window !== "undefined" && typeof document !== "undefined") repaintOnReturn(window);
