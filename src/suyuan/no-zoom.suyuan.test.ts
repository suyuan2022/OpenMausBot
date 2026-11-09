// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { installNoZoom } from "./no-zoom";

describe("installNoZoom", () => {
  it("cancels Safari's pinch gestures until stopped", () => {
    const stop = installNoZoom();
    const pinch = () => {
      const event = new Event("gesturestart", { cancelable: true });
      document.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(pinch()).toBe(true);
    stop();
    expect(pinch()).toBe(false);
  });
});
