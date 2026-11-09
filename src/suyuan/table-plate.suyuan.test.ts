// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installTablePlate, PLATE_SHOWN } from "./table-plate";

let stop = () => {};
const card = (n: number) => document.querySelector(`#c${n}`)!;
const shown = (n: number) => card(n).hasAttribute(PLATE_SHOWN);
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `<div data-table-card id="c1"><div class="table-plate"><button id="b1">copy</button></div><label id="l1">search</label><table><tr><th><button id="s1">sort</button></th></tr><tr><td id="t1">cell</td></tr></table></div>
    <div data-table-card id="c2"><table><tr><td id="t2">cell</td></tr></table></div><p id="out">text</p>`;
  stop = installTablePlate();
});
afterEach(() => { stop(); vi.useRealTimers(); vi.restoreAllMocks(); });

const touch = (type: string, id: string, x = 0, y = 0) =>
  document.getElementById(id)!.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: "touch", clientX: x, clientY: y }));
const tap = (id: string) => { touch("pointerdown", id); touch("pointerup", id); };

describe("tapping a table card stands in for resting the pointer on it", () => {
  it("shows the buttons on a tap in the card and hides them on the next", () => {
    tap("t1");
    expect(shown(1)).toBe(true);
    tap("t1");
    expect(shown(1)).toBe(false);
  });
  it("hides them when a tap lands outside, or on another card", () => {
    tap("t1");
    tap("out");
    expect(shown(1)).toBe(false);
    tap("t1");
    tap("t2");
    expect([shown(1), shown(2)]).toEqual([false, true]);
  });
  it("leaves them as they were when the tap is on a control, a search label included", () => {
    tap("t1");
    tap("b1");
    tap("s1");
    tap("l1");
    expect(shown(1)).toBe(true);
  });
  it("ignores a long press, a drag, and a mouse", () => {
    touch("pointerdown", "t1");
    vi.advanceTimersByTime(500);
    touch("pointerup", "t1");
    touch("pointerdown", "t1", 0, 0);
    touch("pointermove", "t1", 0, 30);
    touch("pointerup", "t1", 0, 30);
    document.getElementById("t1")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
    document.getElementById("t1")!.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "mouse" }));
    expect(shown(1)).toBe(false);
  });
  it("does not toggle while text is selected", () => {
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "82.157" } as Selection);
    tap("t1");
    expect(shown(1)).toBe(false);
  });
});
