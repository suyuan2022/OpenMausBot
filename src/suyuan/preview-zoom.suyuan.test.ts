// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installPreviewZoom } from "./preview-zoom";

let stop: () => void;
let img: HTMLImageElement;
let at = 0;

beforeEach(() => {
  document.body.innerHTML = `<div id="chat"></div><div role="dialog" aria-modal="true"><button>x</button><div><img class="object-contain"></div></div>`;
  img = document.querySelector("img")!;
  Object.defineProperty(img, "offsetWidth", { value: 300 });
  Object.defineProperty(img, "offsetHeight", { value: 200 });
  stop = installPreviewZoom();
});
afterEach(() => stop());

type Point = [number, number];
function fire(type: string, points: Point[], target: Element = img, changed: Point[] = points): TouchEvent {
  at += 50;
  const list = (ps: Point[]) => ps.map(([clientX, clientY]) => ({ clientX, clientY }) as Touch);
  const event = new TouchEvent(type, { bubbles: true, cancelable: true, touches: list(points), changedTouches: list(changed) });
  Object.defineProperty(event, "timeStamp", { value: at });
  target.dispatchEvent(event);
  return event;
}
const tap = (target?: Element) => { fire("touchstart", [[100, 100]], target); fire("touchend", [], target, [[100, 100]]); };
const pinchOut = (to: number) => {
  fire("touchstart", [[100, 100], [200, 100]]);
  fire("touchmove", [[100, 100], [100 + 100 * to, 100]]);
  fire("touchend", [], img, [[100, 100]]);
};

describe("preview zoom", () => {
  it("scales with two fingers, within 1–5×", () => {
    pinchOut(2);
    expect(img.style.transform).toBe("translate(0px, 0px) scale(2)");
    pinchOut(10);
    expect(img.style.transform).toContain("scale(5)");
    fire("touchstart", [[100, 100], [200, 100]]);
    fire("touchmove", [[150, 100], [160, 100]]);
    expect(img.style.transform).toBe("");
  });

  it("pans one finger once zoomed, and not while at 1×", () => {
    const before = fire("touchstart", [[100, 100]]);
    const slide = fire("touchmove", [[160, 130]]);
    expect(img.style.transform).toBe("");
    expect(slide.defaultPrevented).toBe(false);
    expect(before.defaultPrevented).toBe(false);
    fire("touchend", [], img, [[160, 130]]);
    pinchOut(2);
    fire("touchstart", [[100, 100]]);
    const zoomed = fire("touchmove", [[140, 120]]);
    expect(img.style.transform).toBe("translate(40px, 20px) scale(2)");
    expect(zoomed.defaultPrevented).toBe(true);
    fire("touchmove", [[900, 900]]);
    expect(img.style.transform).toBe("translate(150px, 100px) scale(2)");
  });

  it("flips between 1× and 2.5× on a double tap", () => {
    tap();
    tap();
    expect(img.style.transform).toBe("translate(0px, 0px) scale(2.5)");
    tap();
    tap();
    expect(img.style.transform).toBe("");
  });

  it("does not count a slow second tap or a swipe as a double tap", () => {
    tap();
    at += 1000;
    tap();
    expect(img.style.transform).toBe("");
  });

  it("resets when the preview closes: the next picture starts at 1×", () => {
    pinchOut(3);
    document.querySelector("[role=dialog]")!.remove();
    document.body.insertAdjacentHTML("beforeend", `<div role="dialog" aria-modal="true"><div><img class="object-contain"></div></div>`);
    expect(document.querySelector("img")!.style.transform).toBe("");
  });

  it("leaves the chat, the preview's buttons and other dialogs' pictures alone", () => {
    const chat = document.querySelector("#chat")!;
    fire("touchstart", [[100, 100], [200, 100]], chat);
    fire("touchmove", [[100, 100], [300, 100]], chat);
    fire("touchstart", [[100, 100], [200, 100]], document.querySelector("button")!);
    fire("touchmove", [[100, 100], [300, 100]], document.querySelector("button")!);
    expect(img.style.transform).toBe("");
    document.body.insertAdjacentHTML("beforeend", `<div role="dialog" aria-modal="true" id="crop"><img class="rounded"></div>`);
    const crop = document.querySelector<HTMLImageElement>("#crop img")!;
    fire("touchstart", [[100, 100], [200, 100]], crop);
    fire("touchmove", [[100, 100], [300, 100]], crop);
    expect(crop.style.transform).toBe("");
  });
});
