// @vitest-environment happy-dom
// suyuan fork: the Stop button goes while there is something to send, in Simple on a wide screen and on a phone, and stays
// where the field is disabled (waiting for an approval) or an upload is pending, since the text can't be cleared then.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Message } from "@/state/store";
import { changeDraftAttachmentPending, restoreComposerDraft } from "@/lib/drafts";
import { setCallMode } from "@/lib/call-mode";

const fixture = vi.hoisted(() => ({ advanced: false, dispatch: vi.fn() }));
const ENGINE = "claude-3f0c2b1e-9d1a-4c55-8a51-0a3a6f1e2b7c";
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, bots: [bot], instances: [{
      instanceId: ENGINE, driverKind: "claudeAgent", displayName: "Claude", capabilities: { agentsMcp: true },
    }] },
    dispatch: fixture.dispatch,
  }) };
});
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fixture.advanced, setAdvancedMode: vi.fn() }));
vi.mock("./CallView", () => ({ CallButton: () => null }));
vi.mock("./GroupCallView", () => ({ GroupCallButton: () => null }));

import { Composer } from "./Composer";

const approvalCard: Message = {
  id: "ask", role: "bot", kind: "options", at: 1,
  card: { title: "Run a command", subtitle: "ls", options: [], requestId: "request-1", tool: "Bash" },
};
const bot: Bot = {
  id: "atlas", threadId: "atlas-thread", name: "Atlas", title: "", description: "",
  color: "purple", notifications: false, unread: false, busy: true, messages: [], approvalMode: "ask",
  modelSelection: { instanceId: ENGINE, model: "fake" },
};
const draftId = `bot:${bot.id}:${bot.threadId}`;
const paste = { kind: "paste" as const, id: "p1", size: 12, text: "pasted text", lines: 1 };

let root: Root;
let container: HTMLDivElement;
const render = (props: Parameters<typeof Composer>[0] = { bot }) => flushSync(() => root.render(createElement(Composer, props)));
const stop = () => container.querySelector('button[aria-label="Stop this turn"]');
const phone = (on: boolean) => vi.stubGlobal("matchMedia", (query: string) => ({ matches: on && query.includes("max-width: 767.98px"), addEventListener() {}, removeEventListener() {} }));

beforeEach(() => {
  fixture.advanced = false;
  phone(false);
  setCallMode("turns");
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
  restoreComposerDraft(draftId, { text: "", attachments: [] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Stop while the bot works", () => {
  it("is there while the field is empty, on a wide screen and on a phone", () => {
    render();
    expect(stop()).not.toBeNull();
    phone(true);
    render();
    expect(stop()).not.toBeNull();
  });

  it("goes while there is only an attachment", () => {
    restoreComposerDraft(draftId, { text: "", attachments: [paste] });
    render();
    expect(stop()).toBeNull();
  });

  it("goes on a phone while you type", () => {
    phone(true);
    restoreComposerDraft(draftId, { text: "one more thing", attachments: [] });
    render();
    expect(stop()).toBeNull();
    expect(container.querySelector('button[aria-label="Sends when Atlas is done"], button[aria-label^="Send"]')).not.toBeNull();
  });

  it("stays while an approval disables the field, even with text in it", () => {
    restoreComposerDraft(draftId, { text: "one more thing", attachments: [] });
    render({ bot: { ...bot, messages: [approvalCard] } });
    expect(container.querySelector("textarea")!.disabled).toBe(true);
    expect(stop()).not.toBeNull();
  });

  it("stays while an upload is pending, even with text in it", () => {
    restoreComposerDraft(draftId, { text: "one more thing", attachments: [] });
    changeDraftAttachmentPending(draftId, true);
    try {
      render();
      expect(stop()).not.toBeNull();
    } finally {
      changeDraftAttachmentPending(draftId, false);
    }
  });
});
