import { describe, expect, it } from "vitest";

import { afterCheck, CHECK_MARK, checkFirst, withCheck } from "./check-first.ts";

describe("a routine's command check, as its instructions carry it", () => {
  it("is the mark and the command on the first line, with what to do after it", () => {
    const prompt = withCheck(" test -f /tmp/x ", "有新文件，去看一下");
    expect(prompt).toBe(`${CHECK_MARK}test -f /tmp/x\n有新文件，去看一下`);
    expect(checkFirst(prompt)).toEqual({ command: "test -f /tmp/x", rest: "有新文件，去看一下" });
    expect(afterCheck(prompt)).toBe("有新文件，去看一下");
  });

  it("is absent from ordinary instructions, and from a mark with no command", () => {
    expect(checkFirst("查一下证书")).toBeNull();
    expect(checkFirst(`${CHECK_MARK}\n查一下证书`)).toBeNull();
    expect(checkFirst(undefined)).toBeNull();
    expect(afterCheck("查一下证书")).toBe("查一下证书");
    expect(withCheck(undefined, "查一下证书")).toBe("查一下证书");
    expect(withCheck("  ", "查一下证书")).toBe("查一下证书");
  });
});
