// suyuan fork (FORK.md): the home-screen app sometimes comes back from another app (WeChat's voice input, most often) to a
// black screen while the page is alive: the recorder (./lifecycle-log.ts) saw it draw a frame 41ms after its return and fetch
// as usual, yet nothing showed until the person swiped the app away and back. iOS then shows none of what the page draws.
// So every return makes WebKit draw the whole page afresh, twice: right away and once more a little later, in case the screen
// was not ready for the first. The page goes a hair translucent for one frame, which WebKit can only show by painting every
// layer again; nothing visibly changes.
// That alone did not cure it (11/15 00:29): the black comes when the person left with the chat's box focused, as WeChat's
// voice input does, and the keyboard rises again a moment after the return. The recorder saw iOS then give the window
// 403px and its visible part 386px, which agree whenever the keyboard opens in place. So once the keyboard has risen
// after a return, the page also moves a pixel and back, which makes iOS work out afresh what is on screen, and repaints.

/** The second repaint, after the first: long enough for iOS to have put the app back on screen. */
export const AGAIN_MS = 700;
/** After a return, how long the keyboard may take to come back up. */
export const KEYBOARD_BACK_MS = 10_000;
/** The keyboard's slide is over by then. */
export const SETTLE_MS = 350;
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

/** Moves the page a pixel and back, so iOS works out afresh which part of it is on screen. */
export function nudge(win: Window, frame: Frame = requestAnimationFrame) {
  const at = win.scrollY;
  win.scrollTo(0, at > 0 ? at - 1 : at + 1);
  frame(() => win.scrollTo(0, at));
}

/** Repaints on every return to sight: now, and again after `AGAIN_MS`; and once the keyboard has come back up, if it does
 * within `KEYBOARD_BACK_MS`, nudges and repaints again. */
export function repaintOnReturn(win: Window, frame: Frame = requestAnimationFrame) {
  const doc = win.document;
  let returnedAt = -Infinity;
  let settling: number | undefined;
  const both = () => {
    returnedAt = Date.now();
    repaint(doc, frame);
    win.setTimeout(() => repaint(doc, frame), AGAIN_MS);
  };
  const resized = () => {
    if (doc.visibilityState !== "visible" || Date.now() - returnedAt > KEYBOARD_BACK_MS) return;
    win.clearTimeout(settling);
    settling = win.setTimeout(() => {
      nudge(win, frame);
      repaint(doc, frame);
    }, SETTLE_MS);
  };
  doc.addEventListener("visibilitychange", () => { if (doc.visibilityState === "visible") both(); });
  win.addEventListener("pageshow", (event) => { if (event.persisted) both(); });
  win.visualViewport?.addEventListener("resize", resized);
  win.addEventListener("resize", resized);
}

if (typeof window !== "undefined" && typeof document !== "undefined") repaintOnReturn(window);
