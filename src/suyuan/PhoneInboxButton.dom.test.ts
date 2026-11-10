// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/state/api", () => ({ api: vi.fn(async () => ({ botId: null, threadId: null, rows: [], anchor: null })) }));

import { setLocale } from "@/lib/i18n";
import { closeInbox, currentInboxPanel, setInboxView } from "@/state/inbox";
import type { InboxRow } from "../../shared/inbox";
import { PhoneInboxButton } from "./PhoneInboxButton";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const question: InboxRow = {
  id: "card-q", kind: "ask", tab: "needs-you", unread: false, at: Date.now(), from: { name: "Eli", botId: "eli" },
  origin: { botId: "eli", threadId: "eli-launch", title: "Launch work", messageId: "card-q" }, text: "Which page?",
  card: { title: "A question", subtitle: "Which page?", options: ["Home", "Pricing"], requestId: "req-q", requestType: "question" },
};
const view = (rows: InboxRow[]) => ({ botId: null, threadId: null, rows, anchor: null });
const button = () => document.querySelector<HTMLButtonElement>("[data-sidebar-inbox]")!;
const dot = () => document.querySelector("[data-inbox-dot]");

let root: Root;
const onOpened = vi.fn();
const mount = () => act(async () => { root.render(createElement(PhoneInboxButton, { onOpened })); });

beforeEach(() => {
  setLocale("en");
  root = createRoot(document.body.appendChild(document.createElement("div")));
  onOpened.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  closeInbox();
  setInboxView(null);
  document.body.innerHTML = "";
});

describe("the phone's Inbox button", () => {
  it("wears a dot, with no number, while something waits on the person", async () => {
    setInboxView(view([question]));
    await mount();
    expect(dot()).not.toBeNull();
    expect(button().textContent).toBe("");
    expect(button().getAttribute("aria-label")).toBe("Inbox, 1 waiting");
  });

  it("has no dot when nothing waits", async () => {
    setInboxView(view([]));
    await mount();
    expect(dot()).toBeNull();
    expect(button().getAttribute("aria-label")).toBe("Inbox");
  });

  it("opens the Inbox and closes the bot list, and closes the Inbox on the next tap", async () => {
    await mount();
    await act(async () => button().click());
    expect(currentInboxPanel().open).toBe(true);
    expect(onOpened).toHaveBeenCalledTimes(1);
    await act(async () => button().click());
    expect(currentInboxPanel().open).toBe(false);
  });
});
