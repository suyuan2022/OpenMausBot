import { describe, expect, it } from "vitest";
import { trayTop } from "./tray-at-finger";

describe("where a tapped reply's buttons stand", () => {
  it("level with the finger on a tall reply", () => {
    expect(trayTop(500, { top: -400, bottom: 1200 }, 61)).toBe(469.5);
  });

  it("inside the reply when the finger is near its top or bottom", () => {
    expect(trayTop(110, { top: 100, bottom: 900 }, 61)).toBe(100);
    expect(trayTop(895, { top: 100, bottom: 900 }, 61)).toBe(839);
  });

  it("where the stylesheet puts them beside a reply hardly taller than they are", () => {
    expect(trayTop(130, { top: 100, bottom: 200 }, 61)).toBeNull();
  });
});
