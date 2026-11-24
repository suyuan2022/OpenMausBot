// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RUN_STEP_MARK, type RunMessage } from "../../shared/skill-burger/layers";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/api", () => ({ api: (...args: unknown[]) => fixture.api(...args) }));

const { SkillBurgerSlot } = await import("@/components/skill-burger/SkillBurgerSlot");
const { SkillBurgerRow } = await import("./SkillBurgerRow");
const { readSkillBurger, setSkillBurger, useSkillBurger } = await import("./skill-burger");

let root: Root | null = null;
let host: HTMLElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  fixture.api.mockReset();
  fixture.api.mockImplementation(async (path: string) => (path.includes("?runner=")
    ? { workflow: { version: 1, summary: "Files new support email", args: {}, steps: [{ id: "s1", kind: "app", app: "gmail", tool: "GMAIL_FETCH_EMAILS", label: "Fetch emails", args: {} }] }, everyChat: false }
    : {}));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function Probe() {
  return createElement("span", { "data-testid": "shown" }, String(useSkillBurger()));
}

// A finished run of two real steps: what the card shows for, and asks the server to name and explain.
const ask: RunMessage = { id: "u1", role: "user", kind: "text", text: "Email the sales sheet to Priya" };
const app = (id: string, slug: string): RunMessage => ({
  id, role: "bot", kind: "activity",
  tool: { name: "mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL", ok: true, input: JSON.stringify({ tools: [{ tool_slug: slug, arguments: { a: 1 } }] }) },
});
const finishedRun = [ask, app("m1", "GOOGLESHEETS_BATCH_GET"), app("m2", "GMAIL_SEND_EMAIL")];
// A saved Skill Burger's run: the card would ask the server for the burger it is running.
const savedRun: RunMessage[] = [
  { id: "u2", role: "user", kind: "text", text: "/files-new-support-email" },
  { id: "m3", role: "bot", kind: "activity", tool: { name: "s1", ok: true, input: JSON.stringify({ [RUN_STEP_MARK]: "run-1", name: "files-new-support-email", step: "s1" }), output: JSON.stringify({ state: "done" }) } },
];

const slot = async (messages: RunMessage[]) => {
  await act(async () => root!.render(createElement(SkillBurgerSlot, {
    botId: "scout", threadId: "t1", busy: false, canWrite: true, messages, liveTools: new Set<string>(), transcriptKey: "scout:t1",
  })));
  await act(async () => { await Promise.resolve(); });
};

describe("the chat dock's Skill Burger card", () => {
  it("is off until the switch is turned on", () => {
    expect(readSkillBurger()).toBe(false);
  });

  it("shows when the switch is on, and hides again when it is off", async () => {
    await act(async () => root!.render(createElement(Probe)));
    expect(host.textContent).toBe("false");
    await act(async () => setSkillBurger(true));
    expect(host.textContent).toBe("true");
    expect(localStorage.getItem("omb-suyuan-skill-burger")).toBe("1");
    await act(async () => setSkillBurger(false));
    expect(host.textContent).toBe("false");
  });

  it("has a Settings switch that starts off and turns it on", async () => {
    await act(async () => root!.render(createElement(SkillBurgerRow)));
    expect(host.textContent).toContain("显示任务步骤卡片");
    const toggle = host.querySelector<HTMLElement>("[role=switch]")!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => toggle.click());
    expect(readSkillBurger()).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("renders nothing and asks the server nothing while it is off, for a finished run and for a saved burger's run", async () => {
    await slot(finishedRun);
    expect(host.innerHTML).toBe("");
    await slot(savedRun);
    expect(host.innerHTML).toBe("");
    expect(fixture.api).not.toHaveBeenCalled();
  });

  it("shows the card and asks the server for its name and steps once it is on, and takes it away when turned off again", async () => {
    await act(async () => setSkillBurger(true));
    await slot(finishedRun);
    expect(host.querySelector("[data-skill-burger]")).not.toBeNull();
    const asked = fixture.api.mock.calls.map(([path]) => String(path));
    expect(asked.some((path) => path.startsWith("/api/skill-burger-summary"))).toBe(true);
    expect(asked.some((path) => path.startsWith("/api/skill-burger-draft"))).toBe(true);
    await slot(savedRun);
    expect(fixture.api.mock.calls.some(([path]) => String(path).includes("?runner=scout"))).toBe(true);
    await act(async () => setSkillBurger(false));
    expect(host.innerHTML).toBe("");
  });
});
