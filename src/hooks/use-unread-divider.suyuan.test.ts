// @vitest-environment happy-dom
// suyuan fork (FORK.md): the "New messages" divider folds once it has been on screen at the bottom of the chat.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUnreadDivider } from "./use-unread-divider";
import { UNREAD_DIVIDER_FADE_MS, UNREAD_DIVIDER_LINGER_MS } from "@/lib/unread-divider";
import { BotEditorStore, initialState, type Action, type AppState, type Message } from "@/state/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const messages: Message[] = [
  { id: "u1", role: "user", kind: "text", text: "hi", at: 1 },
  { id: "b2", role: "bot", kind: "text", text: "hello", at: 2 },
];
const state: AppState = { ...initialState, unreadDivider: { threadId: "t", messageId: "b2" } };
let dispatched: Action[];
let root: Root;
let divider: HTMLElement;

function Probe({ following }: { following: boolean }) {
  useUnreadDivider({ threadId: "t", messages, following });
  return null;
}
async function draw(following: boolean) {
  const value = { state, dispatch: (action: Action) => { dispatched.push(action); }, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  await act(async () => root.render(createElement(BotEditorStore, { value, children: createElement(Probe, { following }) })));
}
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const folded = () => dispatched.some((action) => action.type === "unreadDividerDone");
/** An IntersectionObserver that reports the divider in view, or out of it, as soon as it is observed. */
function dividerInView(visible: boolean) {
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private readonly report: IntersectionObserverCallback) {}
    observe(target: Element) { this.report([{ target, isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    disconnect() {}
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  dispatched = [];
  window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
  divider = document.body.appendChild(Object.assign(document.createElement("div"), { role: "separator" }));
  divider.setAttribute("data-unread-divider", "");
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  divider.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useUnreadDivider in the suyuan fork", () => {
  it("folds a divider the person has on screen at the bottom, without a scroll", async () => {
    dividerInView(true);
    await draw(true);
    await wait(UNREAD_DIVIDER_LINGER_MS + UNREAD_DIVIDER_FADE_MS);
    expect(folded()).toBe(true);
  });

  it("keeps a divider that is above the screen", async () => {
    dividerInView(false);
    await draw(true);
    await wait(UNREAD_DIVIDER_LINGER_MS + UNREAD_DIVIDER_FADE_MS);
    expect(folded()).toBe(false);
  });

  it("keeps it while the person is scrolled up reading", async () => {
    dividerInView(true);
    await draw(false);
    await wait(UNREAD_DIVIDER_LINGER_MS + UNREAD_DIVIDER_FADE_MS);
    expect(folded()).toBe(false);
  });
});
