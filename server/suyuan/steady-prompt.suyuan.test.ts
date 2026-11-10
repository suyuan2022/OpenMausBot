import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../system-prompt.ts";
import { PER_TURN_SECTIONS } from "./steady-prompt.ts";

type Part = Parameters<typeof buildSystemPrompt>[2][number];
const part = (id: string, text: string): Part => ({ id, label: id, text });
const build = (parts: Part[]) => buildSystemPrompt("You are Lizhi.", "", [part("coordination", " Team rules."), ...parts]);

describe("sections that change between turns stay out of the stable half", () => {
  it.each(PER_TURN_SECTIONS)("a changed %s section leaves the stable half as it was", (id) => {
    const before = build([part(id, " first wording")]);
    const after = build([part(id, " second wording, longer")]);
    const gone = build([part(id, "")]);
    expect(after.stable).toBe(before.stable);
    expect(gone.stable).toBe(before.stable);
    expect(before.stable).not.toContain("first wording");
    expect(before.volatile).toBe(" first wording");
    expect(after.volatile).toBe(" second wording, longer");
    expect(gone.volatile).toBe("");
  });

  it("a section upstream keeps stable on purpose still changes the stable half", () => {
    expect(build([part("webhook", " a")]).stable).not.toBe(build([part("webhook", " b")]).stable);
  });

  it("the whole prompt keeps every section in its place", () => {
    const built = build([part("user-profile", " About the user."), part("mcp", " Servers."), part("recall", " Recall.")]);
    expect(built.text.startsWith("You are Lizhi. Team rules. About the user. Servers. Recall.")).toBe(true);
    expect(built.stable.startsWith("You are Lizhi. Team rules. Recall.")).toBe(true);
    expect(built.volatile).toBe(" About the user. Servers.");
  });
});
