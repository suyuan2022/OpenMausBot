// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/state/api", () => ({ api: vi.fn() }));

import { setLocale, t } from "@/lib/i18n";
import { api } from "@/state/api";
import type { Bot, Message } from "@/state/store";
import { noteThreadsShown } from "./home";
import { QuietRowLine, quietRow } from "./quiet-row";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const line = (id: string, role: "user" | "assistant", text: string) => ({ id, role, kind: "text", text, at: 1 }) as unknown as Message;
const ranBash = { id: "tool", role: "assistant", kind: "activity", at: 1, tool: { name: "Bash", input: { command: "ls" }, ok: true } } as unknown as Message;
// shopping's own conversation, and a run 荔枝 passed on to it.
const shopping = (threadId: string, homeBusy = false) => ({
  id: "shopping", name: "shopping", threadId, mainThreadId: "sh-home", busy: false, messages: [],
  tasks: [{ threadId: "sh-home", title: "", createdAt: 1, updatedAt: 5, busy: homeBusy }, { threadId: "jd", title: "京东", createdAt: 2, busy: true, openedBy: { botId: "lizhi", name: "荔枝" } }],
}) as unknown as Bot;

let root: Root;
const text = () => document.body.textContent;
const mount = (bot: Bot, visible: Message[], waiting = false) =>
  act(async () => { root.render(createElement(QuietRowLine, { bot, visible, instances: [], waiting })); });

beforeEach(() => {
  setLocale("zh-CN");
  noteThreadsShown(false);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  noteThreadsShown(true);
  vi.mocked(api).mockReset();
});

describe("a bot's row in Simple mode", () => {
  it("is quiet only once the app hides the thread list", () => {
    expect(quietRow(true)).toBe(true);
    expect(quietRow(false)).toBe(false);
    noteThreadsShown(true);
    expect(quietRow(true)).toBe(false);
  });

  it("quotes the last line said at home, past a tool step and an English line along the way", async () => {
    await mount(shopping("sh-home", true), [line("p", "user", "炒锅选哪个"), line("a", "assistant", "我先比一下价。"), ranBash, line("b", "assistant", "Comparing prices now.")]);
    expect(text()).toBe("我先比一下价。");
    expect(api).not.toHaveBeenCalled();
  });

  it("says it waits on the person when it does", async () => {
    await mount(shopping("sh-home"), [line("a", "assistant", "要我下单吗？")], true);
    expect(text()).toBe(t("sidebar.preview.waiting"));
  });

  it("on a background run, reads home's newest page without opening it and quotes that, never the run", async () => {
    let answer!: (page: unknown) => void;
    vi.mocked(api).mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    await mount(shopping("jd"), [line("r", "assistant", "@shopping 夙愿的原话：「京东登录…」")]);
    expect(text()).toBe("");
    expect(api).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api).mock.calls[0]).toEqual(["/api/threads/sh-home/messages?limit=20"]);
    await act(async () => answer({ messages: [line("h1", "user", "炒锅最后选哪个"), line("h2", "assistant", "炒锅选好了：WMF 中华炽能 32cm。")] }));
    expect(text()).toBe("炒锅选好了：WMF 中华炽能 32cm。");
  });

  it("reads home again only when something there changed", async () => {
    vi.mocked(api).mockResolvedValue({ messages: [line("h", "assistant", "好了")] });
    const away = shopping("jd");
    await mount(away, []);
    await mount({ ...away, messages: [line("r2", "assistant", "又一句")] } as Bot, []);
    expect(api).toHaveBeenCalledTimes(1);
    await mount({ ...away, tasks: away.tasks!.map((task) => (task.threadId === "sh-home" ? { ...task, updatedAt: 9 } : task)) } as Bot, []);
    expect(api).toHaveBeenCalledTimes(2);
  });
});
