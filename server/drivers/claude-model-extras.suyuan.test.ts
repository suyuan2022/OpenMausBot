import { describe, expect, it } from "vitest";
import { modelContextWindow } from "../model-context-window.ts";
import { listPriceFor } from "../model-prices.ts";
import { STATIC_CLAUDE_MODELS } from "./claude-model-extras.ts";

// suyuan fork (FORK.md): Fable 5.2 in the picker ahead of the upstream sync that brings its model manifest.
describe("Fable 5.2", () => {
  it("is first in the Claude picker, with its 1M context and price", () => {
    expect(STATIC_CLAUDE_MODELS.options[0]).toEqual({ id: "claude-fable-5-2", label: "Claude Fable 5.2", contextWindow: 1_000_000 });
    expect(modelContextWindow("claude-fable-5-2")).toBe(1_000_000);
    expect(modelContextWindow("claude-fable-5-20")).toBe(200_000);
    expect(listPriceFor("claude-fable-5-2")).toMatchObject({ inputPerMillion: 8, outputPerMillion: 40 });
  });
});
