// suyuan fork (11-26): a picture that changes height above the screen moves the scroll with it (./steady-images.ts).
import { describe, expect, it } from "vitest";
import { steadyScroll } from "./steady-images";

const at = (top: number, scrollTop = 0) => ({ scrollTop, getBoundingClientRect: () => ({ top }) }) as unknown as Element;

describe("steadyScroll", () => {
  it("moves the scroll by the change of a picture whose top is above the screen", () => {
    expect(steadyScroll(at(100, 900), at(40), 180)).toBe(1080);
    expect(steadyScroll(at(100, 900), at(40), -60)).toBe(840);
  });

  it("leaves the scroll alone for a picture on or below the top of the screen, or one that kept its height", () => {
    expect(steadyScroll(at(100, 900), at(100), 180)).toBeNull();
    expect(steadyScroll(at(100, 900), at(300), 180)).toBeNull();
    expect(steadyScroll(at(100, 900), at(40), 0)).toBeNull();
  });
});
