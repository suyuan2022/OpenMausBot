// suyuan fork: gemini-4-argon never runs at High, where it writes its thinking into the reply.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { argonAtMostMedium, withoutArgonHigh } from "./argon-thinking.ts";

const levels = [{ id: "low", label: "Low" }, { id: "medium", label: "Medium" }, { id: "high", label: "High" }];
const turn = { threadId: "t", text: "hi" };

describe("argon at Medium at most", () => {
  it("offers no High for argon and leaves the other models alone", () => {
    const catalog = withoutArgonHigh({ default: "gemini-3.8-flash", options: [
      { id: "gemini-4-argon", label: "Gemini 4 Argon", variants: levels },
      { id: "gemini-4-carbon", label: "Gemini 4 Carbon", variants: levels },
    ] });
    expect(catalog.options[0].variants?.map((variant) => variant.id)).toEqual(["low", "medium"]);
    expect(catalog.options[1].variants?.map((variant) => variant.id)).toEqual(["low", "medium", "high"]);
  });

  it("runs a saved High, no level, or the retired -high id at Medium", () => {
    expect(argonAtMostMedium({ ...turn, model: "gemini-4-argon", variant: "high" }, [])).toEqual({ ...turn, model: "gemini-4-argon", variant: "medium" });
    expect(argonAtMostMedium({ ...turn, model: "gemini-4-argon" }, [])).toEqual({ ...turn, model: "gemini-4-argon", variant: "medium" });
    expect(argonAtMostMedium({ ...turn, model: "gemini-4-argon-high" }, ["gemini-4-argon"])).toEqual({ ...turn, model: "gemini-4-argon", variant: "medium" });
  });

  it("hands back the same turn when nothing changes", () => {
    for (const same of [
      { ...turn, model: "gemini-4-argon", variant: "medium" },
      { ...turn, model: "gemini-4-argon", variant: "low" },
      { ...turn, model: "gemini-4-carbon", variant: "high" },
      { ...turn, model: "gemini-3.8-flash" },
    ]) expect(argonAtMostMedium(same, ["gemini-4-argon"])).toBe(same);
  });

  // An upstream merge that rewrites the driver and drops either call fails here.
  it("is wired into the Antigravity driver's model list and every turn's selection", () => {
    const driver = readFileSync(new URL("../drivers/antigravity.ts", import.meta.url), "utf8");
    expect(driver).toMatch(/withoutArgonHigh\(await probeAntigravityModels\(/);
    expect(driver).toMatch(/normalizeSessionSelection: \(turn, offered\) => argonAtMostMedium\(/);
  });
});
