// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installNoZoom } from "./no-zoom";

const pinch = () => {
  const event = new Event("gesturestart", { cancelable: true });
  document.dispatchEvent(event);
  return event.defaultPrevented;
};
afterEach(() => vi.unstubAllGlobals());

describe("installNoZoom", () => {
  it("leaves a trackpad pinch alone where there is no touch screen", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const stop = installNoZoom();
    expect(pinch()).toBe(false);
    stop();
  });

  it("cancels Safari's pinch gestures until stopped", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const stop = installNoZoom();
    expect(pinch()).toBe(true);
    stop();
    expect(pinch()).toBe(false);
  });
});
