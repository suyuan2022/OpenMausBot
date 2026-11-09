// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dispatched = vi.hoisted(() => [] as unknown[]);
vi.mock("@/state/store", () => ({ useStore: () => ({ dispatch: (action: unknown) => dispatched.push(action) }) }));
const { useFillShortChat } = await import("./fill-short-chat");

type Props = Parameters<typeof useFillShortChat>[2] & { threadId?: string };
let root: Root | null = null;
const scroller = document.createElement("div");
const sized = (scrollHeight: number) => Object.defineProperties(scroller, {
  scrollHeight: { configurable: true, value: scrollHeight },
  clientHeight: { configurable: true, value: 800 },
});
const ready: Props = { shown: true, following: true, startIndex: 0, hasMore: true, olderPending: false, count: 50 };

function Chat({ threadId = "thread", ...props }: Props) {
  useFillShortChat({ current: scroller }, threadId, props);
  return null;
}
const show = (props: Props) => act(async () => root!.render(createElement(Chat, props)));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  dispatched.length = 0;
  root = createRoot(document.createElement("div"));
  sized(300);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  vi.unstubAllGlobals();
});

describe("a chat too short to scroll pages older messages in by itself", () => {
  it("asks for the page before while it follows its bottom and can't scroll", async () => {
    await show(ready);
    expect(dispatched).toEqual([{ type: "loadOlderMessages", threadId: "thread" }]);
    await show({ ...ready, olderPending: true });
    await show({ ...ready, count: 100 });
    expect(dispatched).toHaveLength(2);
  });

  it("leaves a chat alone once it scrolls, when scrolled up, mid-window, or with nothing older", async () => {
    sized(1200);
    await show(ready);
    sized(300);
    await show({ ...ready, following: false });
    await show({ ...ready, startIndex: 40 });
    await show({ ...ready, hasMore: false });
    await show({ ...ready, shown: false });
    expect(dispatched).toEqual([]);
  });

  it("stops after 20 pages in one chat, and counts afresh in the next", async () => {
    for (let count = 50; count <= 1500; count += 50) await show({ ...ready, count });
    expect(dispatched).toHaveLength(20);
    await show({ ...ready, threadId: "other" });
    expect(dispatched).toHaveLength(21);
  });
});
