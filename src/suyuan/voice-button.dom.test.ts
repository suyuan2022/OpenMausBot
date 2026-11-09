// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceButtonRow } from "./VoiceButtonRow";
import { readVoiceButton, setVoiceButton, useVoiceButton } from "./voice-button";

let root: Root | null = null;
let host: HTMLElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
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
  return createElement("span", { "data-testid": "shown" }, String(useVoiceButton()));
}

describe("the composer's voice-call button", () => {
  it("is off until the switch is turned on", () => {
    expect(readVoiceButton()).toBe(false);
  });

  it("shows when the switch is on, and hides again when it is off", async () => {
    await act(async () => root!.render(createElement(Probe)));
    expect(host.textContent).toBe("false");
    await act(async () => setVoiceButton(true));
    expect(host.textContent).toBe("true");
    expect(localStorage.getItem("omb-suyuan-voice-button")).toBe("1");
    await act(async () => setVoiceButton(false));
    expect(host.textContent).toBe("false");
  });

  it("has a Settings switch that starts off and turns it on", async () => {
    await act(async () => root!.render(createElement(VoiceButtonRow)));
    const toggle = host.querySelector<HTMLElement>("[role=switch]")!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => toggle.click());
    expect(readVoiceButton()).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });
});
