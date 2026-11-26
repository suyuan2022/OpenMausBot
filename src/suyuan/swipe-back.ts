// suyuan fork: on a phone, a swipe from the screen's left edge brings back the bot list, in place of the button at the
// top left, which touch phones no longer show. The list is a drawer (aside[data-sidebar], src/components/Sidebar.tsx) parked off screen to the left; the swipe
// drags it in under the finger and, let go far or fast enough, opens it through that button (src/App.tsx), so the
// app's own state follows. iOS gives a home-screen web app no back gesture, so the edge is free.
// 11-26: he found it worked one time and not the next ("稍微往下滑一点，它就一会儿行一会儿不行"). The edge was 24px and a
// swipe had to stay within 45° of level over its first 10px, where a thumb still wobbles; now 44px and 60°, a quick
// flick has to have gone somewhere, and a table scrolled sideways keeps a swipe that starts on it.
import { t } from "@/lib/i18n";

/** How far in from the left edge a swipe may start: a fingertip's width, as iOS sizes what a finger hits. */
export const EDGE_PX = 44;
/** How far the finger moves before the swipe counts as sideways, or as a scroll left to the page. */
const DECIDE_PX = 10;
/** How steep, up or down, a swipe may be over those first pixels and still count as sideways: tan 60°. A steeper one is
 * a scroll. Taken for sideways by mistake, a scroll only peeks the list in and lets it slide back. */
const STEEPEST = Math.tan(Math.PI / 3);
/** Let go past this share of the screen's width, the list opens. */
const OPEN_SHARE = 1 / 3;
/** Or flicked at least this fast, in px per ms, */
const FLING = 0.5;
/** having gone at least this far. */
const FLING_PX = 32;
/** Where the list is a drawer: below Tailwind's md. */
const PHONE = "(max-width: 767px)";
/** Where the swipe stands in for the button: a touch screen with the drawer. */
const SWIPE_SCREEN = `(hover: none) and (pointer: coarse) and ${PHONE}`;

const backButton = (label: string) => `#root button[aria-label="${CSS.escape(label)}"]`;
/** A room's header, indented on a phone (pl-11) to clear the button. */
const INDENTED_HEADER = '[class~="@container/roomhead"].pl-11';
export const ROOM_HEADER = `#root ${INDENTED_HEADER}`;

interface Drag {
  drawer: HTMLElement;
  button: HTMLButtonElement;
  startX: number;
  startY: number;
  sideways: boolean;
  x: number;
  at: number;
  speed: number;
}

function parts(doc: Document): { drawer: HTMLElement; button: HTMLButtonElement } | null {
  const button = doc.querySelector<HTMLButtonElement>(backButton(t("app.openBotList")));
  const drawer = doc.querySelector<HTMLElement>("#root aside[data-sidebar]");
  return button && drawer && button.getAttribute("aria-expanded") !== "true" ? { drawer, button } : null;
}

/** Whether the finger lands on something scrolled sideways (a wide table, a code block), which a swipe right scrolls back. */
function onScrolledAside(target: EventTarget | null): boolean {
  for (let node = target instanceof Element ? target : null; node; node = node.parentElement) {
    if (node.scrollLeft > 0) return true;
  }
  return false;
}

/** Listens for the swipe; returns what stops listening. */
export function installSwipeBack(doc: Document = document): () => void {
  let drag: Drag | null = null;

  const settle = (open: boolean) => {
    if (!drag) return;
    const { drawer, button, sideways } = drag;
    drag = null;
    if (!sideways) return;
    drawer.style.transition = "";
    drawer.style.removeProperty("will-change");
    if (open) button.click();
    // The drawer's class says where it rests; dropping the finger's position lets it slide there from under the finger.
    requestAnimationFrame(() => drawer.style.removeProperty("translate"));
  };

  const start = (event: TouchEvent) => {
    drag = null;
    const touch = event.touches[0];
    if (event.touches.length !== 1 || !touch || touch.clientX > EDGE_PX || !matchMedia(PHONE).matches) return;
    if (onScrolledAside(event.target)) return;
    const found = parts(doc);
    if (!found) return;
    drag = { ...found, startX: touch.clientX, startY: touch.clientY, sideways: false, x: touch.clientX, at: event.timeStamp, speed: 0 };
  };

  const move = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (!drag || !touch) return;
    const dx = touch.clientX - drag.startX;
    if (!drag.sideways) {
      const dy = touch.clientY - drag.startY;
      if (Math.hypot(dx, dy) < DECIDE_PX) return;
      if (dx <= 0 || Math.abs(dy) > dx * STEEPEST) {
        drag = null;
        return;
      }
      drag.sideways = true;
      drag.drawer.style.transition = "none";
      drag.drawer.style.willChange = "translate";
    }
    event.preventDefault();
    const elapsed = event.timeStamp - drag.at;
    if (elapsed > 0) drag.speed = (touch.clientX - drag.x) / elapsed;
    drag.x = touch.clientX;
    drag.at = event.timeStamp;
    drag.drawer.style.translate = `calc(-100% + ${Math.max(0, dx)}px) 0`;
  };

  const end = () => {
    if (!drag) return;
    const dx = drag.x - drag.startX;
    settle(dx > window.innerWidth * OPEN_SHARE || (drag.speed > FLING && dx >= FLING_PX));
  };
  const cancel = () => settle(false);

  doc.addEventListener("touchstart", start, { passive: true });
  doc.addEventListener("touchmove", move, { passive: false });
  doc.addEventListener("touchend", end);
  doc.addEventListener("touchcancel", cancel);
  return () => {
    doc.removeEventListener("touchstart", start);
    doc.removeEventListener("touchmove", move);
    doc.removeEventListener("touchend", end);
    doc.removeEventListener("touchcancel", cancel);
  };
}

/** The last-screen cover (last-frame.ts) shows a copy of #root before the style below is in, so on a touch phone the
 * copy leaves the button out and gives a room's header the same room as the live page. */
export function withoutBackButton(copy: ParentNode, label: string = t("app.openBotList")): void {
  if (typeof matchMedia !== "function" || !matchMedia(SWIPE_SCREEN).matches) return;
  copy.querySelector(`button[aria-label="${CSS.escape(label)}"]`)?.remove();
  for (const header of copy.querySelectorAll<HTMLElement>(INDENTED_HEADER)) header.style.paddingLeft = "1.25rem";
}

/** Where the swipe works the button goes; still in the page, it opens the list when the swipe clicks it. A room's
 * header (src/components/RoomHeader.tsx) gives up the room it kept for the button. `label` is the button's name in the
 * language shown; returns what brings the button back. */
export function hideBackButton(label: string, doc: Document = document): () => void {
  const style = doc.createElement("style");
  style.textContent = `@media ${SWIPE_SCREEN} { ${backButton(label)} { display: none; } ${ROOM_HEADER} { padding-left: 1.25rem; } }`;
  doc.head.append(style);
  return () => style.remove();
}
