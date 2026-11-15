import { describe, expect, it } from "vitest";

import { asPlain, PLAIN_MARK, plainText, withoutPlainMark } from "./plain-reminder.ts";

describe("a reminder that needs no AI", () => {
  it("is the instructions that open with the mark, and sends what follows it", () => {
    expect(plainText(`${PLAIN_MARK}\n记得问物业供暖`)).toBe("记得问物业供暖");
    expect(plainText(`  ${PLAIN_MARK} 记得问物业供暖\n第二行 `)).toBe("记得问物业供暖\n第二行");
  });

  it("is not instructions for a model, a mark further down, or a mark with nothing after it", () => {
    expect(plainText("在聊天里提醒他问物业供暖")).toBeNull();
    expect(plainText(`先查天气\n${PLAIN_MARK}\n记得带伞`)).toBeNull();
    expect(plainText(`${PLAIN_MARK}\n  `)).toBeNull();
    expect(plainText(undefined)).toBeNull();
  });

  it("marks a text once, and gives it back as written", () => {
    const marked = asPlain("记得带伞");
    expect(marked).toBe(`${PLAIN_MARK}\n记得带伞`);
    expect(asPlain(marked)).toBe(marked);
    expect(withoutPlainMark(marked)).toBe("记得带伞");
    expect(withoutPlainMark("先查天气再说")).toBe("先查天气再说");
  });
});
