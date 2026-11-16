// suyuan fork: a bot with an MCP server the person added for screen work (lcu) is told every turn that the server is a
// proper way to work and comes first for web pages, and is never pinned to the built-in browser by a turn on its own.
// The wording is checked on what server/surface.ts really builds, so an upstream change of that text goes red here.
import { describe, expect, it } from "vitest";

import { resolveSurface, surfacePrompt, type MountedSurfaces } from "../surface.ts";
import { autoPinPatch, screenMcpNames, screenMcpWording, withoutAutoBrowserPin } from "./screen-mcp.ts";

const LCU = ["lcu"];
/** Phrases that told a bot the built-in browser was the only place, or that lcu was a substitute. */
const SHUTS_OUT = [
  "Everything you do on screen happens",
  "another automation path",
  "mounted browser/computer tools first",
  "Web tasks → the built-in browser.",
  "You cannot open apps, click, or inspect a screen through OpenMausBot",
  "use the selected OpenMausBot browser when",
  "No computer or browser tools are mounted yet; select_computer is the way to connect them before screen work,",
];

/** One turn of a bot on Auto, as server/index.ts builds it: the plan from the stored pin, then the reworded section. */
function autoTurn(task: { surface?: "browser" | "vm"; surfaceSource?: "user" | "auto" } | undefined, names: string[], mounted: MountedSurfaces = { computer: null, browser: true }) {
  const plan = resolveSurface({ destination: undefined, pinnedSurface: withoutAutoBrowserPin(task, names)?.surface, browserOn: true });
  return screenMcpWording(surfacePrompt(mounted, { pinned: plan.pinned, note: plan.note }),
    { names, browser: mounted.browser, chose: plan.pinned === "browser" });
}

describe("screenMcpNames", () => {
  it("is the listed servers the turn has, and none when config lists none", () => {
    expect(screenMcpNames({ screenMcpServers: ["lcu", "other"] }, { hindsight: {}, lcu: {} })).toEqual(["lcu"]);
    expect(screenMcpNames({ screenMcpServers: ["lcu"] }, { hindsight: {} })).toEqual([]);
    expect(screenMcpNames({ screenMcpServers: ["lcu"] }, undefined)).toEqual([]);
    expect(screenMcpNames({}, { lcu: {} })).toEqual([]);
  });
});

describe("a bot on Auto with lcu", () => {
  it("is told lcu comes first for web pages, with nothing left that shuts it out", () => {
    const text = autoTurn(undefined, LCU);
    for (const phrase of SHUTS_OUT) expect(text).not.toContain(phrase);
    expect(text).not.toContain("pinned to");
    expect(text).toContain("use lcu or OpenMausBot's mounted browser/computer tools:");
    expect(text).toContain("to read web pages or use a site they are signed in to, use lcu first.");
    expect(text).toContain("Use the built-in browser only for a step the person must do by hand in it, such as scanning a QR code or passing a CAPTCHA.");
    expect(text).toContain("Where the person's rules say which to use, follow them.");
    // Said first, ahead of the long account of OpenMausBot's own tools.
    expect(text.startsWith(" The person added the lcu MCP server so you can work in the browsers and apps on their own computers")).toBe(true);
    expect(text.indexOf("use lcu first.")).toBeLessThan(text.indexOf("The screen tools OpenMausBot mounted this turn work in the built-in browser tab"));
    // What upstream says of the built-in browser itself stays.
    expect(text).toContain("tell them it is in the Browser tab of the Screen panel");
  });

  it("is not told it is pinned to the built-in browser by a pin an earlier turn made on its own", () => {
    const text = autoTurn({ surface: "browser", surfaceSource: "auto" }, LCU);
    expect(text).not.toContain("pinned to");
    expect(text).toBe(autoTurn(undefined, LCU));
  });

  it("keeps upstream's section, word for word, when the person pinned the built-in browser themselves", () => {
    const upstream = surfacePrompt({ computer: null, browser: true }, { pinned: "browser" });
    expect(autoTurn({ surface: "browser", surfaceSource: "user" }, LCU)).toBe(upstream);
    expect(autoTurn({ surface: "browser" }, LCU)).toBe(upstream);
    expect(upstream).toContain("pinned to the built-in browser");
  });

  it("still hears of a pin to a computer, and that lcu is outside what pins cover", () => {
    const text = autoTurn({ surface: "vm", surfaceSource: "auto" }, LCU, { computer: "vm", browser: false });
    expect(text).toContain("This conversation is pinned to the Local VM");
    expect(text).toContain("what it says about places, pins and switching covers only those, never lcu.");
    expect(text).not.toContain("built-in browser only for a step"); // no built-in browser this turn, so none is offered
    for (const phrase of SHUTS_OUT) expect(text).not.toContain(phrase);
  });

  it.each<[string, MountedSurfaces, Parameters<typeof surfacePrompt>[1]]>([
    ["the built-in browser alone", { computer: null, browser: true }, {}],
    ["the built-in browser, with select_computer", { computer: null, browser: true }, { canSelect: true }],
    ["the built-in browser, in a thread a bot opened", { computer: null, browser: true }, { botOpened: true }],
    ["a Local VM beside the browser", { computer: "vm", browser: true }, {}],
    ["a Local VM alone", { computer: "vm", browser: false }, {}],
    ["this computer beside the browser", { computer: "local", browser: true }, {}],
    ["this computer alone", { computer: "local", browser: false }, {}],
    ["a cloud computer alone", { computer: "cloud", browser: false }, {}],
    ["nothing mounted", { computer: null, browser: false }, {}],
    ["nothing mounted yet, with select_computer", { computer: null, browser: false }, { canSelect: true }],
  ])("has no sentence that shuts lcu out with %s", (_name, mounted, opts) => {
    const upstream = surfacePrompt(mounted, opts);
    const text = screenMcpWording(upstream, { names: LCU, browser: mounted.browser });
    expect(text).not.toBe(upstream);
    for (const phrase of SHUTS_OUT) expect(text).not.toContain(phrase);
    expect(text).toContain("use lcu first.");
    expect(text.includes("Use the built-in browser only for a step")).toBe(mounted.browser);
  });

  it("with nothing mounted, is sent to the person only for what lcu cannot do", () => {
    const text = screenMcpWording(surfacePrompt({ computer: null, browser: false }), { names: LCU, browser: false });
    expect(text).toContain("If asked for screen work that lcu cannot do, explain this and ask the user to choose where this conversation works");
  });

  it("with nothing mounted yet and select_computer at hand, is sent to select_computer only for what lcu cannot do", () => {
    // 荔枝's own turns: her built-in browser is off, and a message from the person offers select_computer.
    const text = screenMcpWording(surfacePrompt({ computer: null, browser: false }, { canSelect: true }), { names: LCU, browser: false });
    expect(text.startsWith(" The person added the lcu MCP server")).toBe(true);
    expect(text).toContain("select_computer is the way to connect them before screen work that lcu cannot do, not a reason to claim you already performed it.");
  });

  it("names every listed server", () => {
    const text = screenMcpWording(surfacePrompt({ computer: null, browser: true }), { names: ["lcu", "desk"], browser: true });
    expect(text).toContain("The person added the lcu and desk MCP servers");
    expect(text).toContain("use lcu and desk first.");
  });
});

describe("a bot without such a server, or a turn that may not work a screen", () => {
  it("gets upstream's section unchanged", () => {
    for (const task of [undefined, { surface: "browser", surfaceSource: "auto" }, { surface: "browser", surfaceSource: "user" }] as const) {
      const pinned = task?.surface ?? null;
      expect(autoTurn(task, [])).toBe(surfacePrompt({ computer: null, browser: true }, { pinned }));
    }
    expect(autoTurn({ surface: "browser", surfaceSource: "auto" }, [])).toContain("This conversation is pinned to the built-in browser");
  });

  it("leaves Works on Off and the built-in browser chosen in Works on as they are", () => {
    const off = resolveSurface({ destination: "off", browserOn: true });
    const offText = surfacePrompt({ computer: null, browser: false }, { note: off.note });
    expect(screenMcpWording(offText, { names: LCU, browser: false })).toBe(offText);
    const worksOnBrowser = surfacePrompt({ computer: null, browser: true });
    expect(screenMcpWording(worksOnBrowser, { names: LCU, browser: true, chose: true })).toBe(worksOnBrowser);
  });
});

describe("the pin a turn leaves behind", () => {
  it("is never the built-in browser for a bot with lcu, and a pin an earlier turn left there is cleared", () => {
    expect(autoPinPatch("browser", LCU, undefined)).toBeNull();
    expect(autoPinPatch("browser", LCU, {})).toBeNull();
    expect(autoPinPatch("browser", LCU, { surface: "browser", surfaceSource: "auto" })).toEqual({ surface: undefined, surfaceSource: undefined });
    expect(Object.keys(autoPinPatch("browser", LCU, { surface: "browser", surfaceSource: "auto" })!)).toEqual(["surface", "surfaceSource"]);
  });

  it("is the place the turn used in every other case, as upstream stores it", () => {
    expect(autoPinPatch("vm", LCU, undefined)).toEqual({ surface: "vm", surfaceSource: "auto" });
    expect(autoPinPatch("browser", [], undefined)).toEqual({ surface: "browser", surfaceSource: "auto" });
    expect(autoPinPatch("browser", [], { surface: "browser", surfaceSource: "auto" })).toEqual({ surface: "browser", surfaceSource: "auto" });
    expect(autoPinPatch(null, LCU, { surface: "browser", surfaceSource: "auto" })).toBeNull();
  });

  it("is ignored when read back only if a turn made it, to the built-in browser, for a bot with lcu", () => {
    const auto = { threadId: "t", surface: "browser", surfaceSource: "auto" } as const;
    expect(withoutAutoBrowserPin(auto, LCU)).toEqual({ threadId: "t", surface: undefined, surfaceSource: undefined });
    expect(withoutAutoBrowserPin(auto, [])).toBe(auto);
    const person = { surface: "browser", surfaceSource: "user" } as const, vm = { surface: "vm", surfaceSource: "auto" } as const;
    expect(withoutAutoBrowserPin(person, LCU)).toBe(person);
    expect(withoutAutoBrowserPin(vm, LCU)).toBe(vm);
    expect(withoutAutoBrowserPin(undefined, LCU)).toBeUndefined();
  });
});
