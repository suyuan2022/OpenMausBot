// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/lib/i18n";
import { hideBackButton, installSwipeBack } from "./swipe-back";

let stop: () => void;
let opened: number;

beforeEach(() => {
  document.body.innerHTML = `<div id="root"><button aria-label="${t("app.openBotList")}" aria-expanded="false"></button><aside data-sidebar></aside></div>`;
  opened = 0;
  document.querySelector("button")!.addEventListener("click", () => opened++);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(402);
  stop = installSwipeBack();
});
afterEach(() => {
  stop();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const drawer = () => document.querySelector<HTMLElement>("aside")!;
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

function touch(type: string, x: number, y: number, at: number): TouchEvent {
  const event = new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === "touchend" ? [] : [{ clientX: x, clientY: y } as Touch] });
  Object.defineProperty(event, "timeStamp", { value: at });
  document.dispatchEvent(event);
  return event;
}

/** A finger from (x0, y) along the given x positions, 16ms apart, then lifted. */
function swipe(x0: number, y: number, xs: number[], { dy = 0 } = {}): TouchEvent[] {
  touch("touchstart", x0, y, 0);
  const moves = xs.map((x, index) => touch("touchmove", x, y + dy * (index + 1), 16 * (index + 1)));
  touch("touchend", xs.at(-1)!, y, 16 * xs.length);
  return moves;
}

describe("swipe back", () => {
  it("drags the bot list in under a finger from the left edge, and opens it through its button when let go past a third", async () => {
    touch("touchstart", 8, 400, 0);
    const moving = touch("touchmove", 60, 402, 100);
    expect(moving.defaultPrevented).toBe(true);
    expect(drawer().style.translate).toBe("calc(-100% + 52px) 0");
    expect(drawer().style.transition).toBe("none");
    touch("touchmove", 200, 404, 400);
    touch("touchend", 200, 404, 500);
    expect(opened).toBe(1);
    expect(drawer().style.transition).toBe("");
    await frame();
    expect(drawer().style.translate).toBe("");
  });

  it("lets a short, slow swipe go back without opening the list", async () => {
    touch("touchstart", 8, 400, 0);
    touch("touchmove", 60, 400, 100);
    touch("touchmove", 100, 400, 400);
    touch("touchend", 100, 400, 500);
    expect(opened).toBe(0);
    await frame();
    expect(drawer().style.translate).toBe("");
  });

  it("opens the list on a quick flick that has not gone far", () => {
    swipe(8, 400, [40, 80, 120]);
    expect(opened).toBe(1);
  });

  it("leaves a vertical scroll from the edge to the page", () => {
    const moves = swipe(8, 400, [12, 14, 16], { dy: 30 });
    expect(moves.some((event) => event.defaultPrevented)).toBe(false);
    expect(drawer().style.translate).toBe("");
    expect(opened).toBe(0);
  });

  it("ignores a swipe that starts away from the edge, with the list open, or on a wide screen", () => {
    swipe(40, 400, [100, 200, 300]);
    document.querySelector("button")!.setAttribute("aria-expanded", "true");
    swipe(8, 400, [100, 200, 300]);
    document.querySelector("button")!.setAttribute("aria-expanded", "false");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    swipe(8, 400, [100, 200, 300]);
    expect(opened).toBe(0);
    expect(drawer().style.translate).toBe("");
  });
});

describe("the back button", () => {
  it("is hidden only where the swipe works, with a room's header moving into its place, and comes back when let go", () => {
    document.getElementById("root")!.insertAdjacentHTML("beforeend", '<div class="@container/roomhead px-5 py-3 pl-11 md:pl-5"></div>');
    const show = hideBackButton(t("app.openBotList"));
    const style = document.head.querySelector("style")!;
    const [, media, selector, header] = style.textContent!.match(/^@media (.+?) \{ (.+?) \{ display: none; \} (.+?) \{ padding-left: 1\.25rem; \} \}$/)!;
    expect(media).toBe("(hover: none) and (pointer: coarse) and (max-width: 767px)");
    expect(document.querySelector(selector!)).toBe(document.querySelector("button"));
    expect(document.querySelector(header!)?.className).toContain("@container/roomhead");
    show();
    expect(style.isConnected).toBe(false);
  });
});
