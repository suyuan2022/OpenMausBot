// @vitest-environment happy-dom
// suyuan fork: the phone's inbox is a page over the bot list (./phone-inbox.ts).
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ view: null as unknown }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("@/state/api", () => ({ api: vi.fn(async () => server.view) }));

import { initialState, StoreContext, type AppState, type Bot } from "@/state/store";
import { loadLocale, setLocale, t } from "@/lib/i18n";
import { closeInbox, currentInboxPanel, openInbox, setInboxView } from "@/state/inbox";
import { approvalRow, INBOX_NOW, inboxView, reportRow } from "@/testing/inbox-fixture";
import type { InboxView } from "../../shared/inbox";
import { InboxPanel } from "@/components/inbox/InboxPanel";
import { SidebarInboxRow } from "@/components/SidebarInboxRow";
import { useBotListDrawer, type DrawerPlace } from "@/hooks/use-bot-list-drawer";
import { CLOSE_BOT_DRAWER_EVENT, closeBotDrawer, useCloseBotDrawer } from "./phone-inbox";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
const dispatch = vi.fn();
const asked = vi.fn();
const mount = (child: ReactElement, bots: Bot[] = []) => act(async () => {
  root.render(createElement(StoreContext.Provider,
    { value: { state: { ...initialState, bots } as AppState, dispatch, flushBotPatches: vi.fn(), refreshInstances: vi.fn(), refreshModels: vi.fn() } as never }, child));
});
const click = (element: Element | null | undefined) => act(async () => { (element as HTMLElement).click(); });
const shown = (view: InboxView) => { server.view = view; setInboxView(view); };
const onPhone = (phone: boolean) => vi.stubGlobal("matchMedia", (query: string) => ({ matches: phone && query.includes("max-width"), addEventListener() {}, removeEventListener() {} }));

beforeEach(() => {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  dispatch.mockClear();
  asked.mockClear();
  window.addEventListener(CLOSE_BOT_DRAWER_EVENT, asked);
  shown(inboxView());
  onPhone(true);
});
afterEach(() => {
  act(() => root.unmount());
  window.removeEventListener(CLOSE_BOT_DRAWER_EVENT, asked);
  closeInbox();
  setInboxView(null);
  setLocale("en");
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("opening the inbox from the bot list", () => {
  const row = (onOpened: () => void) => createElement(SidebarInboxRow, { icons: false, large: false, running: false, onOpened });

  it("on a phone opens the inbox and leaves the bot list open under it", async () => {
    const onOpened = vi.fn();
    await mount(row(onOpened));
    await click(document.querySelector("[data-sidebar-inbox]"));
    expect(currentInboxPanel().open).toBe(true);
    expect(onOpened, "the bot list is not told to close").not.toHaveBeenCalled();
    expect(asked).not.toHaveBeenCalled();
  });

  it("off a phone still tells whoever asked that it opened", async () => {
    onPhone(false);
    const onOpened = vi.fn();
    await mount(row(onOpened));
    await click(document.querySelector("[data-sidebar-inbox]"));
    expect(currentInboxPanel().open).toBe(true);
    expect(onOpened).toHaveBeenCalledTimes(1);
  });
});

describe("the bot list under the phone's inbox", () => {
  const START: DrawerPlace = { selectedId: "scout", botThread: "private", groupThread: undefined, view: "chat", pluginsOpen: false, settingsOpen: false };
  /** The app's wiring (src/App.tsx): the list with its Inbox row and a conversation row, and the inbox drawn over it. */
  function Shell({ place }: { place: DrawerPlace }) {
    const drawer = useBotListDrawer(place);
    useCloseBotDrawer(drawer.hide);
    return createElement("div", { onClickCapture: drawer.open ? drawer.noteAction : undefined },
      createElement("button", { "aria-label": "Open bot list", "aria-expanded": drawer.open, onClick: drawer.show }),
      createElement("button", { "data-sidebar-inbox": 0 }, createElement("span", { "data-inner": "row" })),
      createElement("button", { "data-row": "thread" }),
      createElement("section", { "data-inbox-panel": "sheet" }, createElement("button", { "data-inner": "panel" })));
  }
  const show = (place: DrawerPlace) => act(async () => root.render(createElement(Shell, { place })));
  const expanded = () => document.querySelector('[aria-label="Open bot list"]')!.getAttribute("aria-expanded");
  const opened = async () => { await show(START); await click(document.querySelector('[aria-label="Open bot list"]')); };

  it("stays open after a tap on the Inbox row or inside the inbox, when the conversation under it then changes", async () => {
    await opened();
    await click(document.querySelector('[data-inner="row"]'));
    await click(document.querySelector('[data-inner="panel"]'));
    await show({ ...START, botThread: "shared" });
    expect(expanded()).toBe("true");
  });

  it("still closes for a conversation picked in the list itself", async () => {
    await opened();
    await click(document.querySelector('[data-row="thread"]'));
    await show({ ...START, botThread: "picked" });
    expect(expanded()).toBe("false");
  });

  it("closes when the inbox asks, even though the conversation on screen did not change", async () => {
    await opened();
    await act(async () => closeBotDrawer());
    expect(expanded()).toBe("false");
  });
});

describe("the inbox on a phone", () => {
  const classes = (selector: string) => document.querySelector(selector)!.className.split(" ");

  it("is a page over the whole screen, not a sheet with the conversation showing above it", async () => {
    openInbox();
    await mount(createElement(InboxPanel));
    const panel = document.querySelector<HTMLElement>('[data-inbox-panel="sheet"]')!;
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.parentElement!.hasAttribute("data-inbox-page")).toBe(true);
    expect(classes("[data-inbox-page]")).toEqual(expect.arrayContaining(["fixed", "inset-0", "z-50", "bg-app"]));
    expect(classes("[data-inbox-page]"), "nothing shows through, and the panel is not pushed to the foot").not.toEqual(expect.arrayContaining(["bg-black/40"]));
    expect(classes("[data-inbox-page]")).not.toContain("justify-end");
    expect(classes('[data-inbox-panel="sheet"]')).toEqual(expect.arrayContaining(["h-full", "flex-1", "bg-app", "pt-[env(safe-area-inset-top)]", "pb-[env(safe-area-inset-bottom)]"]));
    for (const sheet of ["max-h-[85dvh]", "min-h-[50dvh]", "rounded-t-2xl", "border-t"]) expect(classes('[data-inbox-panel="sheet"]')).not.toContain(sheet);
  });

  it("stays as it was off a phone: a panel at the side", async () => {
    onPhone(false);
    openInbox();
    await mount(createElement(InboxPanel));
    expect(document.querySelector('[data-inbox-panel="side"]')).not.toBeNull();
    expect(document.querySelector("[data-inbox-page]")).toBeNull();
  });
});

describe("going from the inbox into a conversation", () => {
  const reporter = {
    id: "reporter", name: "Reporter", threadId: "rep-main", tasks: [
      { threadId: "rep-main", title: "Main", createdAt: 0, updatedAt: INBOX_NOW - 120_000 },
      { threadId: "rep-pinned", title: "Pinned digest", createdAt: 0, updatedAt: INBOX_NOW, pinned: true },
      { threadId: "rep-busy", title: "Working on it", createdAt: 0, updatedAt: INBOX_NOW - 60_000, busy: true },
    ],
  } as unknown as Bot;
  const entries: Array<[string, () => Element | null | undefined]> = [
    ["a finished line", () => document.querySelector(`[data-inbox-row="${reportRow.id}"] button`)],
    ["a pinned conversation", () => document.querySelector("[data-inbox-pinned] [data-pinned-row]")],
    ["a conversation at work", () => document.querySelector("[data-inbox-active] button:not([data-inbox-pin])")],
  ];

  it.each(entries)("on a phone, %s closes the inbox and asks the bot list to close", async (_what, find) => {
    openInbox();
    await mount(createElement(InboxPanel), [reporter]);
    expect(find(), "the entry is on the page").toBeTruthy();
    await click(find());
    expect(dispatch, "the conversation opens").toHaveBeenCalled();
    expect(currentInboxPanel().open).toBe(false);
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it("on a phone, a line that waits on an answer opens in the inbox and closes nothing", async () => {
    openInbox();
    await mount(createElement(InboxPanel), [reporter]);
    await click(document.querySelector(`[data-inbox-row="${approvalRow.id}"] button`));
    expect(currentInboxPanel()).toMatchObject({ open: true, reading: approvalRow.id });
    expect(asked).not.toHaveBeenCalled();
  });

  it.each(entries)("off a phone, %s leaves the inbox at the side and asks nothing of the bot list", async (_what, find) => {
    onPhone(false);
    openInbox();
    await mount(createElement(InboxPanel), [reporter]);
    await click(find());
    expect(dispatch).toHaveBeenCalled();
    expect(currentInboxPanel().open).toBe(true);
    expect(asked).not.toHaveBeenCalled();
  });
});

describe("the empty inbox in Chinese", () => {
  it("says what will show up here, in Chinese", async () => {
    expect(await loadLocale("zh")).toBe("zh");
    expect(t("inbox.emptyHint")).toBe("当机器人需要你确认、向你提问或完成任务时，会显示在这里。");
    shown(inboxView([]));
    openInbox();
    await mount(createElement(InboxPanel));
    expect(document.querySelector("[data-inbox-empty]")!.textContent).toContain("当机器人需要你确认、向你提问或完成任务时，会显示在这里。");
  });
});
