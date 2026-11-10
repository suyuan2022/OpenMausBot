// @vitest-environment happy-dom
// suyuan fork: on a phone a long press on a home tile opens the bot's menu, and nothing else about the tile changes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installTileMenu } from "./tile-menu";

let stop = () => {};
let menus: MouseEvent[] = [];
let opens = 0;
const tile = () => document.getElementById("tile")!;
const touch = (type: string, x = 100, y = 120, pointerType = "touch", id = "tile") =>
  document.getElementById(id)!.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType, clientX: x, clientY: y }));
const click = (id = "tile") => document.getElementById(id)!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  document.body.innerHTML = `<div data-sidebar-tiles><div data-sidebar-tile="pinned" id="tile" draggable="true"><span id="face">face</span><input id="name"></div></div>
    <div data-sidebar-bot-row id="row">a list row</div>`;
  menus = [];
  opens = 0;
  // SidebarTiles.tsx: the tile's onContextMenu opens the menu, its onClick the chat.
  tile().addEventListener("contextmenu", (event) => menus.push(event as MouseEvent));
  tile().addEventListener("click", () => { opens += 1; });
  stop = installTileMenu();
});

afterEach(() => {
  stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a home tile's menu on a phone", () => {
  it("opens where the finger rests after half a second, and the lift does not open the chat", () => {
    touch("pointerdown", 100, 120, "touch", "face");
    vi.advanceTimersByTime(499);
    expect(menus).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(menus).toHaveLength(1);
    expect([menus[0]!.clientX, menus[0]!.clientY]).toEqual([100, 120]);
    touch("pointerup");
    click("face");
    expect(opens).toBe(0);
    // Only that one click is dropped: the next tap opens the chat.
    touch("pointerdown");
    touch("pointerup");
    click();
    expect(opens).toBe(1);
    expect(menus).toHaveLength(1);
  });

  it("stays shut for a tap, for a finger that travels, and for a touch the browser takes over", () => {
    touch("pointerdown");
    touch("pointerup");
    vi.advanceTimersByTime(600);
    touch("pointerdown");
    touch("pointermove", 100, 131);
    vi.advanceTimersByTime(600);
    touch("pointerdown");
    touch("pointercancel");
    vi.advanceTimersByTime(600);
    expect(menus).toHaveLength(0);
  });

  it("lets a resting finger wobble a few pixels", () => {
    touch("pointerdown");
    touch("pointermove", 104, 126);
    vi.advanceTimersByTime(500);
    expect(menus).toHaveLength(1);
  });

  it("leaves a mouse, a wider screen, a list row and the rename field alone", () => {
    touch("pointerdown", 100, 120, "mouse");
    vi.advanceTimersByTime(600);
    touch("pointerdown", 100, 120, "touch", "row");
    vi.advanceTimersByTime(600);
    touch("pointerdown", 100, 120, "touch", "name");
    vi.advanceTimersByTime(600);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    touch("pointerdown");
    vi.advanceTimersByTime(600);
    expect(menus).toHaveLength(0);
    expect(tile().getAttribute("draggable")).toBe("true");
  });

  it("stops the tile being draggable at the touch, so iOS does not lift it under the long press", () => {
    touch("pointerdown");
    expect(tile().getAttribute("draggable")).toBe("false");
  });

  it("takes its listeners away", () => {
    stop();
    touch("pointerdown");
    vi.advanceTimersByTime(600);
    expect(menus).toHaveLength(0);
  });
});
