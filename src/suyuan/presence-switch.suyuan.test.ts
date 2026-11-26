// @vitest-environment happy-dom
// suyuan fork (11-26): opening another chat while a bot works must not carry its working line over to fade out there;
// the new chat's last message dropped down when the line went (TurnPresence.tsx).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TurnPresence } from "@/components/TurnPresence";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const render = (props: Record<string, unknown>) =>
  act(() => root.render(createElement(TurnPresence, { avatar: null, visible: true, since: null, label: "Working", ...props })));
const drawn = () => host.childElementCount > 0;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

it("drops the working line at once when the chat on screen is another thread", () => {
  render({ threadId: "busy" });
  expect(drawn()).toBe(true);
  render({ threadId: "idle", visible: false });
  expect(drawn()).toBe(false);
});

it("still fades the line out in the same chat when the turn ends", () => {
  render({ threadId: "t" });
  render({ threadId: "t", visible: false });
  expect(drawn()).toBe(true);
  act(() => vi.advanceTimersByTime(300));
  expect(drawn()).toBe(false);
});
