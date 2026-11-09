// @vitest-environment happy-dom
// suyuan fork: a touch on a message shows its buttons only when it is meant for the message, not for the scroll.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { MESSAGE_ROW, MessageActions } from "./MessageActions";

let host: HTMLDivElement;
let root: Root;

const body = () => host.querySelector<HTMLElement>("p")!;
const shown = () => host.querySelector<HTMLElement>('[data-testid="message-actions"]')!.dataset.shown === "true";
const pointer = (type: string, clientY = 10) =>
  act(async () => { body().dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: "touch", clientX: 10, clientY })); });
// The press's timer only: when the page last scrolled is read off the real clock, as in a browser.
const fakeTimers = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
const scroll = () => act(async () => { document.dispatchEvent(new Event("scroll")); });

beforeEach(async () => {
  // The last test's scroll is still fresh: a touch this soon would be the one that stops a fling.
  await new Promise((resolve) => setTimeout(resolve, 200));
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement("div", { [MESSAGE_ROW]: "" },
      createElement("p", null, "an answer"),
      createElement(MessageActions, { side: "bot", children: createElement("button", { type: "button" }, "react") })));
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("message actions on a touch screen", () => {
  it("hides what a long press showed when the finger goes on to scroll", async () => {
    fakeTimers();
    await pointer("pointerdown");
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(shown()).toBe(true);
    await scroll();
    expect(shown()).toBe(false);
  });

  it("hides them too when the held finger moves away before the page scrolls", async () => {
    fakeTimers();
    await pointer("pointerdown");
    await act(async () => { vi.advanceTimersByTime(500); });
    await pointer("pointermove", 40);
    expect(shown()).toBe(false);
  });

  it("keeps a long press's buttons once the finger lifts, through a later scroll", async () => {
    fakeTimers();
    await pointer("pointerdown");
    await act(async () => { vi.advanceTimersByTime(500); });
    await pointer("pointerup");
    await scroll();
    expect(shown()).toBe(true);
  });

  it("does not take the touch that stops a fling for a tap, and takes the next one", async () => {
    await scroll();
    await pointer("pointerdown");
    await pointer("pointerup");
    expect(shown()).toBe(false);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
    await pointer("pointerdown");
    await pointer("pointerup");
    expect(shown()).toBe(true);
  });
});
