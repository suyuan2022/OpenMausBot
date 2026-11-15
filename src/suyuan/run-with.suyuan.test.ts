import { describe, expect, it } from "vitest";

import { PLAIN_MARK } from "../../shared/suyuan/plain-reminder";
import { CHECK_MARK } from "../../shared/suyuan/check-first";
import { commandOf, modelFor, runWithFields, runWithOf, shownText } from "./run-with";

const ENGINE = { instanceId: "claude", models: { options: [{ id: "claude-opus-5-5" }, { id: "claude-sonnet-5-5" }, { id: "claude-haiku-5-5" }, { id: "claude-haiku-4-5" }] } };

describe("what a scheduled automation runs with, in the form", () => {
  it("reads the choice off a routine", () => {
    expect(runWithOf(undefined)).toBe("bot");
    expect(runWithOf({ prompt: "查证书" })).toBe("bot");
    expect(runWithOf({ prompt: `${PLAIN_MARK}\n记得带伞` })).toBe("none");
    expect(runWithOf({ prompt: "查证书", modelSelection: { model: "claude-haiku-5-5" } })).toBe("haiku");
    expect(runWithOf({ prompt: "查证书", modelSelection: { model: "claude-sonnet-5-5" } })).toBe("sonnet");
  });

  it("saves a plain reminder as marked instructions with no model, and a model choice as the routine's own model", () => {
    expect(runWithFields("none", "记得带伞", ENGINE)).toEqual({ prompt: `${PLAIN_MARK}\n记得带伞`, modelSelection: null });
    expect(runWithFields("bot", `${PLAIN_MARK}\n记得带伞`, ENGINE)).toEqual({ prompt: "记得带伞", modelSelection: null });
    expect(runWithFields("haiku", "查证书", ENGINE)).toEqual({ prompt: "查证书", modelSelection: { instanceId: "claude", model: "claude-haiku-5-5" } });
    expect(runWithFields("sonnet", "查证书", ENGINE)).toEqual({ prompt: "查证书", modelSelection: { instanceId: "claude", model: "claude-sonnet-5-5" } });
  });

  it("leaves the model alone when the bot's engine has no such model", () => {
    const codex = { instanceId: "codex", models: { options: [{ id: "gpt-6-astra" }] } };
    expect(modelFor("haiku", codex)).toBeUndefined();
    expect(runWithFields("haiku", "查证书", codex)).toEqual({ prompt: "查证书" });
    expect(runWithFields("haiku", "查证书", undefined)).toEqual({ prompt: "查证书" });
  });

  it("keeps the command a routine runs first through an edit, and shows the text after it", () => {
    const was = `${CHECK_MARK}test -f /tmp/arrived\n${PLAIN_MARK}\n包裹到了`;
    expect(commandOf({ prompt: was })).toBe("test -f /tmp/arrived");
    expect(commandOf({ prompt: "查证书" })).toBeUndefined();
    expect(shownText(was)).toBe("包裹到了");
    expect(runWithOf({ prompt: was })).toBe("none");
    expect(runWithFields("none", "包裹到了，去拿", ENGINE, was).prompt).toBe(`${CHECK_MARK}test -f /tmp/arrived\n${PLAIN_MARK}\n包裹到了，去拿`);
    expect(runWithFields("haiku", "看看包裹是谁的", ENGINE, was).prompt).toBe(`${CHECK_MARK}test -f /tmp/arrived\n看看包裹是谁的`);
  });
});
