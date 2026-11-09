// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTablePlate, PLATE_SHOWN } from "./table-plate";

let stop = () => {};
const card = (n: number) => document.querySelector(`#c${n}`)!;
beforeEach(() => {
  document.body.innerHTML = `<div data-table-card id="c1"><div class="table-plate"><button id="b1">copy</button></div><table><tr><th><button id="s1">sort</button></th></tr><tr><td id="t1">cell</td></tr></table></div>
    <div data-table-card id="c2"><table><tr><td id="t2">cell</td></tr></table></div><p id="out">text</p>`;
  stop = installTablePlate();
});
afterEach(() => stop());
const tap = (id: string) => document.getElementById(id)!.click();

describe("tapping a table card stands in for resting the pointer on it", () => {
  it("shows the buttons on a tap in the card and hides them on the next", () => {
    tap("t1");
    expect(card(1).hasAttribute(PLATE_SHOWN)).toBe(true);
    tap("t1");
    expect(card(1).hasAttribute(PLATE_SHOWN)).toBe(false);
  });
  it("hides them when a tap lands outside, or on another card", () => {
    tap("t1");
    tap("out");
    expect(card(1).hasAttribute(PLATE_SHOWN)).toBe(false);
    tap("t1");
    tap("t2");
    expect([card(1), card(2)].map((c) => c.hasAttribute(PLATE_SHOWN))).toEqual([false, true]);
  });
  it("leaves them as they were when the tap is on a button", () => {
    tap("t1");
    tap("b1");
    tap("s1");
    expect(card(1).hasAttribute(PLATE_SHOWN)).toBe(true);
  });
});
