import { describe, expect, it } from "vitest";

import { engineCompactsItself } from "./native-compact.ts";

describe("which engines compact their own conversation", () => {
  it("is Claude Code only: every other engine keeps OpenMausBot's fold", () => {
    expect(engineCompactsItself("claudeAgent")).toBe(true);
    for (const kind of ["codex", "openai-compat", "piAgent", "hermesAgent", "grokAgent"]) expect(engineCompactsItself(kind)).toBe(false);
  });
});
