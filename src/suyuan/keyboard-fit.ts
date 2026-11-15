// suyuan fork (FORK.md): on the iPhone the keyboard rising pushed the whole page up out of sight (the recorder saw the window
// scrolled 409-426px, header and all), and coming back from another app in that state, WeChat's voice input most often,
// left the screen black although the page drew and took touches (11/15 08:22). Repainting on return did not cure it
// (./wake-paint.ts). So the page is never pushed: while the keyboard is up the app is exactly as tall as what is left
// above it (keyboard-fit.css), the header stays, the messages get shorter and the box sits on the keyboard, as in WeChat.

/** Anything shorter than this is not the keyboard: a bar sliding in, the address bar. */
export const KEYBOARD_MIN_PX = 120;

/** How much of the screen the keyboard leaves, or null when it is down. `full` is the window without the keyboard. */
export function roomAboveKeyboard(full: number, visible: number): number | null {
  return full - visible >= KEYBOARD_MIN_PX ? Math.round(visible) : null;
}

/** Keeps the app the height of what the keyboard leaves, and the page unscrolled. Returns the undo. */
export function installKeyboardFit(win: Window = window): () => void {
  const view = win.visualViewport;
  if (!view || !win.matchMedia("(hover: none) and (pointer: coarse)").matches) return () => {};
  const root = win.document.documentElement;
  const fit = () => {
    // The root's own height is the window's without the keyboard: iOS shrinks innerHeight with it, not this.
    const room = roomAboveKeyboard(root.clientHeight, view.height);
    if (room === null) {
      if (!root.hasAttribute("data-keyboard")) return;
      root.removeAttribute("data-keyboard");
      root.style.removeProperty("--keyboard-room");
    } else {
      root.setAttribute("data-keyboard", "");
      root.style.setProperty("--keyboard-room", `${room}px`);
    }
    if (win.scrollY !== 0) win.scrollTo(0, 0);
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
  };
}
