// @vitest-environment happy-dom
// suyuan fork: the composer's voice-call button, and the + menu's call modes, wait for the Settings switch (src/suyuan/voice-button.ts).
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group } from "@/state/store";
import { restoreComposerDraft } from "@/lib/drafts";
import { setCallMode } from "@/lib/call-mode";
import { endCall, startCall } from "@/lib/call";
import { setVoiceButton } from "@/suyuan/voice-button";

const fixture = vi.hoisted(() => ({
  advanced: false,
  dispatch: vi.fn(),
  call: null as Record<string, unknown> | null,
  groupCall: null as Record<string, unknown> | null,
  liveCall: null as unknown,
}));
const ENGINE = "claude-3f0c2b1e-9d1a-4c55-8a51-0a3a6f1e2b7c";
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, bots: [bot, peer], liveCall: fixture.liveCall, instances: [{
      instanceId: ENGINE, driverKind: "claudeAgent", displayName: "Claude", capabilities: { agentsMcp: true },
    }] },
    dispatch: fixture.dispatch,
  }) };
});
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fixture.advanced, setAdvancedMode: vi.fn() }));
vi.mock("./CallView", () => ({ CallButton: (props: Record<string, unknown>) => {
  fixture.call = props;
  return null;
} }));
vi.mock("./GroupCallView", () => ({ GroupCallButton: (props: Record<string, unknown>) => {
  fixture.groupCall = props;
  return null;
} }));

import { Composer } from "./Composer";

const bot: Bot = {
  id: "atlas", threadId: "atlas-thread", name: "Atlas", title: "", description: "",
  color: "purple", notifications: false, unread: false, busy: false, messages: [], approvalMode: "ask",
  modelSelection: { instanceId: ENGINE, model: "fake" },
};
const peer: Bot = { ...bot, id: "juniper", threadId: "juniper-thread", name: "Juniper", color: "teal" };
const room: Group = {
  id: "room", threadId: "room-thread", name: "Launch planning", memberIds: [bot.id, peer.id],
  defaultResponder: { kind: "member", botId: bot.id }, bulletin: "", unread: false,
  createdAt: 1, setupCompletedAt: 1, messages: [],
};

let root: Root;
let container: HTMLDivElement;
const render = (props: Parameters<typeof Composer>[0]) => flushSync(() => root.render(createElement(Composer, props)));
const plus = () => container.querySelector<HTMLElement>("[data-composer-plus]")?.closest("button") ?? null;
const click = (element: Element | null) => {
  if (!element) throw new Error("nothing to click");
  flushSync(() => (element as HTMLElement).click());
};
const callKeys = () => [...document.body.querySelectorAll<HTMLElement>('[data-menu-key^="call:"]')].map((entry) => entry.dataset.menuKey);

beforeEach(() => {
  fixture.advanced = false;
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("max-width: 767.98px"), addEventListener() {}, removeEventListener() {} }));
  fixture.liveCall = null;
  setCallMode("turns");
  const voiceStore = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => voiceStore.get(key) ?? null, setItem: (key: string, value: string) => voiceStore.set(key, value) });
  fixture.call = null;
  fixture.groupCall = null;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
  for (const id of [`bot:${bot.id}:${bot.threadId}`, `group:${room.id}:${room.threadId}`]) restoreComposerDraft(id, { text: "", attachments: [] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  flushSync(() => root.unmount());
  endCall();
  container.remove();
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the composer's voice-call button", () => {
  it("is not drawn until Settings turns it on, and the phone + menu offers no call modes", () => {
    render({ bot });
    expect(fixture.call).toBeNull();
    click(plus());
    expect(callKeys()).toEqual([]);
  });

  it("is not drawn in a room either, until it is on", () => {
    render({ group: room, members: [bot, peer] });
    expect(fixture.groupCall).toBeNull();
    setVoiceButton(true);
    render({ group: room, members: [bot, peer] });
    expect(fixture.groupCall).toMatchObject({ group: { id: "room" }, placement: "composer" });
  });

  it("is drawn, and the phone + menu offers both call modes, once it is on", () => {
    setVoiceButton(true);
    render({ bot });
    expect(fixture.call).toMatchObject({ bot: { id: "atlas" }, placement: "composer" });
    click(plus());
    expect(callKeys()).toEqual(["call:turns", "call:live"]);
  });

  it("stays on a call that is running with the switch off, so it can be hung up", () => {
    startCall(bot.id);
    render({ bot });
    expect(fixture.call).toMatchObject({ bot: { id: "atlas" } });
  });
});
