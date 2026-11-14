// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/state/store", () => ({ useStore: () => ({ state: { bots: [{ id: "lizhi", name: "荔枝" }] } }) }));

import { PassedOnFrom } from "./PassedOnFrom";

const shown = (passed: { botId: string; name: string } | null) => renderToStaticMarkup(createElement(PassedOnFrom, { passed }));

describe("PassedOnFrom", () => {
  it("names the passing bot as it is called now, then the arrow", () => {
    expect(shown({ botId: "lizhi", name: "Fixture Starter" })).toContain(">荔枝</span>");
  });

  it("keeps the name the run recorded once that bot is gone", () => {
    expect(shown({ botId: "gone", name: "旧助手" })).toContain(">旧助手</span>");
  });

  it("is nothing on a thread no bot passed on", () => {
    expect(shown(null)).toBe("");
  });
});
