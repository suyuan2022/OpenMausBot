// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGAIN_MS, KEYBOARD_BACK_MS, SETTLE_MS, nudge, repaint } from "./wake-paint";

/** Frames run only when the test says so, the module's own too: set before the import above wires it to this window. */
const queued = vi.hoisted(() => {
  const callbacks: Array<() => void> = [];
  globalThis.requestAnimationFrame = (callback) => (callbacks.push(() => callback(0)), callbacks.length);
  return callbacks;
});
const next = () => queued.splice(0).forEach((callback) => callback());

function seeing(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  document.documentElement.style.opacity = "";
  vi.useRealTimers();
});

describe("repaint on return", () => {
  it("makes the root a hair translucent for one frame, then puts back what it had", () => {
    document.documentElement.style.opacity = "1";
    repaint(document);
    expect(document.documentElement.style.opacity).toBe("0.999");
    next();
    expect(document.documentElement.style.opacity).toBe("0.999");
    next();
    expect(document.documentElement.style.opacity).toBe("1");
  });

  it("does not stack a second repaint on one still showing", () => {
    repaint(document);
    repaint(document);
    next();
    next();
    expect(document.documentElement.style.opacity).toBe("");
  });

  it("repaints when the page comes back in sight, and again a moment later, not when it goes", () => {
    vi.useFakeTimers();
    seeing("hidden");
    expect(document.documentElement.style.opacity).toBe("");
    seeing("visible");
    expect(document.documentElement.style.opacity).toBe("0.999");
    next();
    next();
    expect(document.documentElement.style.opacity).toBe("");
    vi.advanceTimersByTime(AGAIN_MS);
    expect(document.documentElement.style.opacity).toBe("0.999");
  });
});

describe("nudge once the keyboard is back", () => {
  it("moves the page a pixel and puts it back the next frame", () => {
    const moves: number[] = [];
    const spy = vi.spyOn(window, "scrollTo").mockImplementation(((_x: number, y: number) => { moves.push(y); }) as typeof window.scrollTo);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 409 });
    nudge(window);
    next();
    expect(moves).toEqual([408, 409]);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    moves.length = 0;
    nudge(window);
    next();
    expect(moves).toEqual([1, 0]);
    spy.mockRestore();
  });

  it("nudges after a resize shortly after a return, once it settles, and not long after", () => {
    vi.useFakeTimers();
    const moves: number[] = [];
    const spy = vi.spyOn(window, "scrollTo").mockImplementation(((_x: number, y: number) => { moves.push(y); }) as typeof window.scrollTo);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    seeing("visible");
    next(); next();
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(SETTLE_MS);
    expect(moves).toEqual([1]);
    expect(document.documentElement.style.opacity).toBe("0.999");
    next(); next();
    vi.advanceTimersByTime(KEYBOARD_BACK_MS);
    moves.length = 0;
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(SETTLE_MS);
    expect(moves).toEqual([]);
    spy.mockRestore();
  });
});
