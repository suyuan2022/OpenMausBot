// @vitest-environment happy-dom
// suyuan fork: which block of a split reply the buttons stand beside, and when a tap moves them rather than hides them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installTrayAtFinger, trayMoves } from "./tray-at-finger";

let stop = () => {};
const el = (id: string) => document.getElementById(id)!;
const tray = () => el("tray");
const box = (id: string, top: number, bottom: number) =>
  vi.spyOn(el(id), "getBoundingClientRect").mockReturnValue({ top, bottom, left: 0, right: 330, width: 330, height: bottom - top, x: 0, y: top, toJSON: () => ({}) });
const touch = (type: string, id: string, clientY: number, pointerType = "touch") => {
  const event = new PointerEvent(type, { bubbles: true, pointerType, clientY });
  el(id).dispatchEvent(event);
  return event;
};
/** MessageActions.tsx shows the buttons by this mark once the touch turns out to be a tap. */
const show = () => { tray().dataset.shown = "true"; };

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  // A reply split around a table: bubble, table card, bubble, inside the wrapper that carries the bubble mark too.
  document.body.innerHTML = `<div data-message-row class="items-start" id="row"><div data-chat-bubble="simple" id="wrap"><div data-reply-blocks>
    <div id="first"><div data-chat-bubble="simple" id="b1"><p id="p1">intro</p></div><div data-testid="message-actions" id="tray"><button id="react">react</button></div></div>
    <div data-reply-table id="t1"><table><tr><td id="cell">399</td></tr></table></div>
    <div data-chat-bubble="simple" id="b2"><p id="p2">a long paragraph</p></div></div></div></div>
    <div data-message-row class="items-end" id="mine"><div data-chat-bubble="simple"><p id="q">a question</p></div></div>`;
  box("row", 100, 800); box("first", 100, 158); box("b1", 100, 158); box("t1", 170, 292); box("b2", 304, 800);
  Object.defineProperty(tray(), "offsetParent", { configurable: true, get: () => el("first") });
  Object.defineProperty(tray(), "offsetHeight", { configurable: true, get: () => 61 });
  stop = installTrayAtFinger();
});
afterEach(() => { stop(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("a tap on one block of a split reply", () => {
  it("stands the hidden buttons beside the table that was touched", () => {
    touch("pointerdown", "cell", 230);
    // Level with the finger inside the 122px card, measured from the first block the column hangs on.
    expect(tray().style.top).toBe("100px");
    expect(tray().style.bottom).toBe("auto");
  });

  it("moves showing buttons to another block and keeps them, and hides them on the block they stand beside", () => {
    touch("pointerdown", "cell", 230);
    show();
    // The same card again: nothing moves, and the tap hides them.
    expect(trayMoves(touch("pointerup", "cell", 250))).toBe(false);
    expect(tray().style.top).toBe("100px");
    // The paragraph below: they move there and stay.
    touch("pointerdown", "p2", 500);
    expect(tray().style.top).toBe("100px");
    expect(trayMoves(touch("pointerup", "p2", 500))).toBe(true);
    expect(tray().style.top).toBe("370px");
    expect(trayMoves(touch("pointerup", "p2", 600))).toBe(false);
  });

  it("leaves them alone for a mouse, a touch on the buttons, someone's own message, or a wider screen", () => {
    show();
    expect(trayMoves(touch("pointerup", "p2", 500, "mouse"))).toBe(false);
    expect(trayMoves(touch("pointerup", "react", 120))).toBe(false);
    expect(trayMoves(touch("pointerup", "q", 900))).toBe(false);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(trayMoves(touch("pointerup", "p2", 500))).toBe(false);
    expect(tray().style.top).toBe("");
  });
});
