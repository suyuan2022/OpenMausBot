// @vitest-environment happy-dom
// suyuan fork: on the phone the list covers the conversation, so tapping the room that is already open has to close it.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, Group, InstanceInfo, Task } from "@/state/store";

const layout = vi.hoisted(() => ({ phone: true }));
vi.mock("@/lib/use-media-query", async (original) => {
  const actual = await original<typeof import("@/lib/use-media-query")>();
  return { ...actual, useMediaQuery: (query: string, fallback: boolean) => (query === actual.PHONE_LAYOUT ? layout.phone : fallback) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => true }));

// The simple-mode list loads things from the server; no server answers here, so its requests just wait.
vi.stubGlobal("fetch", () => new Promise(() => {}));
const { Sidebar } = await import("./Sidebar");
const { BotEditorStore, initialState } = await import("@/state/store");

const task = (threadId: string, title: string): Task =>
  ({ threadId, title, createdAt: 1, updatedAt: 1, busy: false, activity: "idle", modelSelection: { instanceId: "test", model: "m" }, approvalMode: "ask" });
const bot = (id: string, name: string): Bot => ({
  id, threadId: `${id}-chat`, name, title: "", description: "", color: "green", notifications: true, unread: false, busy: false,
  messages: [], modelSelection: { instanceId: "test", model: "m" }, tasks: [task(`${id}-chat`, name)],
});
const shoes: Group = {
  id: "shoes", threadId: "shoes-now", name: "Shoes", memberIds: ["outfit", "shopping"], bulletin: "", unread: false, createdAt: 1, messages: [],
  defaultResponder: { kind: "auto", fallbackBotId: "outfit" },
};
const state: AppState = {
  ...initialState,
  connected: true,
  selectedId: "shoes",
  activeView: "chat",
  bots: [bot("outfit", "Outfit"), bot("shopping", "Shopping")],
  groups: [shoes],
  instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test", snapshot: { state: "available" } } as InstanceInfo],
};

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  layout.phone = true;
});

async function tapOpen(selector: string, groups = [shoes]) {
  const onClose = vi.fn();
  const value = { state: { ...state, groups }, dispatch: vi.fn(), flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  flushSync(() => root.render(createElement(BotEditorStore, { value, children: createElement(Sidebar, { open: true, onClose }) })));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const row = host.querySelector<HTMLElement>(selector);
  expect(row?.getAttribute("aria-current")).toBe("page");
  row!.click();
  return onClose;
}

const openRoom = '[data-sidebar-group-row="shoes"]';

describe("Sidebar: tapping the open room", () => {
  it("closes the phone's list, as tapping the open bot does", async () => {
    expect(await tapOpen(openRoom)).toHaveBeenCalled();
  });

  it("closes it from the room's open thread too", async () => {
    const threads = [{ threadId: "shoes-now", title: "Sneakers", createdAt: 2 }, { threadId: "shoes-old", title: "Boots", createdAt: 1 }];
    expect(await tapOpen('[data-sidebar-thread-row="shoes-now"]', [{ ...shoes, tasks: threads }])).toHaveBeenCalled();
  });

  it("leaves the wide screen's side list alone", async () => {
    layout.phone = false;
    expect(await tapOpen(openRoom)).not.toHaveBeenCalled();
  });
});
