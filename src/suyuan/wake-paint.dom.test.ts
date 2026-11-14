// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGAIN_MS, repaint } from "./wake-paint";

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
