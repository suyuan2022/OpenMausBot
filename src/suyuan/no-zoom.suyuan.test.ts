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

  it("caps the viewport's scale on a touch screen only, and puts it back when stopped", () => {
    document.head.innerHTML = '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />';
    const content = () => document.querySelector('meta[name="viewport"]')!.getAttribute("content");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    installNoZoom()();
    expect(content()).not.toContain("maximum-scale");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const stop = installNoZoom();
    expect(content()).toBe("width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1");
    stop();
    expect(content()).toBe("width=device-width, initial-scale=1.0, viewport-fit=cover");
  });

  it("cancels Safari's pinch gestures until stopped", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const stop = installNoZoom();
    expect(pinch()).toBe(true);
    stop();
    expect(pinch()).toBe(false);
  });
});
