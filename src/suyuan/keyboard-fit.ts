// suyuan fork (FORK.md): on the iPhone the app left it to iOS to push the page up when the keyboard rose, and iOS does it
// unevenly. The recorder saw the window scrolled 409-426px, header and all; three times on 11/15 (22:50, 23:13, 23:23) the
// keyboard was up and the page not pushed at all, or by 352px where 409 was due, so the box sat under the keyboard until a
// second tap; and each change of the push was the whole screen jumping. So the app no longer counts on the push: while the
// keyboard is up it is laid out on exactly the part of the page that shows (keyboard-fit.css), however far iOS pushed. The
// header stays, the messages get shorter with their end still on the box, and the box sits on the keyboard, as in WeChat.

/** Anything shorter than this is not the keyboard: a bar sliding in, the address bar. */
export const KEYBOARD_MIN_PX = 120;
/** A keyboard that got this much shorter is still the same keyboard: WeChat's is 409 or 426px from one moment to the next. */
export const KEYBOARD_SLACK_PX = 40;

/** The open chat's (or room's) message list. */
const CHAT = "main .glass-scroller";

/** How far a list is scrolled up from its end. */
function fromEnd(el: HTMLElement): number {
  return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
}

/** How tall the app is to be: what the keyboard leaves of `full` (the window without it), or null when it is down. `room`
 * is what the app has now. A keyboard that grows is followed at once; one that shrinks a little is not, so that the box
 * does not hop each time a bar on the keyboard comes and goes. */
export function roomAboveKeyboard(full: number, visible: number, room: number | null = null): number | null {
  if (full - visible < KEYBOARD_MIN_PX) return null;
  const next = Math.round(visible);
  return room !== null && next > room && next - room < KEYBOARD_SLACK_PX ? room : next;
}

/** Keeps the app on what the keyboard leaves of the screen: that tall, and starting where it starts. Returns the undo. */
export function installKeyboardFit(win: Window = window): () => void {
  const view = win.visualViewport;
  if (!view || !win.matchMedia("(hover: none) and (pointer: coarse)").matches) return () => {};
  const doc = win.document;
  const root = doc.documentElement;
  let room: number | null = null;
  const fit = () => {
    // Zoomed in, the visible part is short without any keyboard: leave the page as it is.
    if (Math.abs(view.scale - 1) > 0.01) return;
    // The root's clientHeight is the window's height without the keyboard, whatever height the page itself has.
    const next = roomAboveKeyboard(root.clientHeight, view.height, room);
    if (next !== room) {
      // A shorter chat keeps its top where it was, which hid the newest messages behind the box (11/15 23:27):
      // what sat at the bottom stays at the bottom, as in WeChat.
      const chats = [...doc.querySelectorAll<HTMLElement>(CHAT)].map((el) => [el, fromEnd(el)] as const);
      if (next === null) {
        root.removeAttribute("data-keyboard");
        root.style.removeProperty("--keyboard-room");
        root.style.removeProperty("--keyboard-top");
      } else {
        root.setAttribute("data-keyboard", "");
        root.style.setProperty("--keyboard-room", `${next}px`);
      }
      room = next;
      for (const [el, gap] of chats) el.scrollTop = el.scrollHeight - el.clientHeight - gap;
    }
    if (room === null) return;
    // iOS may also push the page, by any amount and at any moment: 409px, 352px, nothing, 34px on a change of keyboard.
    // Pushing back is a fight it wins (it moves what shows instead of the page), so the app goes where the push put what
    // shows. pageTop says where that is; offsetTop on iOS 26 repeats the page's scroll while it pushes.
    const top = `${Math.max(0, Math.round(view.pageTop))}px`;
    if (root.style.getPropertyValue("--keyboard-top") !== top) root.style.setProperty("--keyboard-top", top);
  };
  view.addEventListener("resize", fit);
  view.addEventListener("scroll", fit);
  win.addEventListener("scroll", fit);
  fit();
  return () => {
    view.removeEventListener("resize", fit);
    view.removeEventListener("scroll", fit);
    win.removeEventListener("scroll", fit);
    root.removeAttribute("data-keyboard");
    root.style.removeProperty("--keyboard-room");
    root.style.removeProperty("--keyboard-top");
  };
}
