import { describe, expect, it } from "vitest";
import { trayTop } from "./tray-at-finger";

const row = { top: -400, bottom: 1200 };

describe("where a tapped reply's buttons stand", () => {
  it("level with the finger inside a block taller than they are", () => {
    expect(trayTop(500, { top: -400, bottom: 1200 }, row, 61)).toBe(469.5);
  });

  it("inside the block when the finger is near its top or bottom", () => {
    const block = { top: 100, bottom: 900 };
    expect(trayTop(110, block, row, 61)).toBe(100);
    expect(trayTop(895, block, row, 61)).toBe(839);
  });

  it("beside the tapped block, not the reply's first one", () => {
    // A table card 122px tall, 270px down a reply that starts with a short bubble.
    expect(trayTop(330, { top: 270, bottom: 392 }, { top: 100, bottom: 800 }, 61)).toBe(299.5);
  });

  it("centred on a block no taller than they are, inside the reply", () => {
    expect(trayTop(340, { top: 300, bottom: 358 }, { top: 100, bottom: 800 }, 61)).toBe(298.5);
    // The reply's first block: they do not rise above the reply.
    expect(trayTop(120, { top: 100, bottom: 158 }, { top: 100, bottom: 800 }, 61)).toBe(100);
  });

  it("where the stylesheet puts them beside a reply hardly taller than they are", () => {
    expect(trayTop(130, { top: 100, bottom: 200 }, { top: 100, bottom: 200 }, 61)).toBeNull();
  });
});
