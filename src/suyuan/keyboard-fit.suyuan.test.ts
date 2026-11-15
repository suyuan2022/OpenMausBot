import { describe, expect, it } from "vitest";
import { KEYBOARD_MIN_PX, roomAboveKeyboard } from "./keyboard-fit";

describe("room above the keyboard", () => {
  it("is what the keyboard leaves once it is up", () => {
    expect(roomAboveKeyboard(812, 386)).toBe(386);
    expect(roomAboveKeyboard(812, 402.6)).toBe(403);
  });

  it("is nothing while the keyboard is down or something smaller slid in", () => {
    expect(roomAboveKeyboard(812, 812)).toBeNull();
    expect(roomAboveKeyboard(812, 812 - KEYBOARD_MIN_PX + 1)).toBeNull();
  });
});
