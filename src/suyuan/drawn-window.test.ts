import { describe, expect, it } from "vitest";
import { TRANSCRIPT_WINDOW_SIZE, followWindowStart, resolveTranscriptWindow } from "@/lib/transcript-window";
import { drawnExpandStart, drawnTailStart } from "./drawn-window";

type Row = { role: "user" | "bot"; kind: "text" | "activity" };
const text = (role: Row["role"] = "bot"): Row => ({ role, kind: "text" });
const steps = (count: number): Row[] => Array.from({ length: count }, () => ({ role: "bot", kind: "activity" }));

describe("a chat's window counts only the rows it draws", () => {
  it("starts at the row that leaves `size` drawn rows after it, tool steps between them included", () => {
    const rows = [text(), ...steps(5), text(), text("user"), ...steps(3), text()];
    expect(drawnTailStart(rows, 3)).toBe(6);
    expect(drawnTailStart(rows, 10)).toBe(0);
    expect(drawnTailStart([], 3)).toBe(0);
  });

  it("grows by `size` drawn rows before its start", () => {
    const rows = [text(), text(), ...steps(4), text(), text()];
    expect(drawnExpandStart(rows, 6, 1)).toBe(1);
    expect(drawnExpandStart(rows, 6, 5)).toBe(0);
  });

  it("keeps the earlier chat in view through a turn of hundreds of tool steps", () => {
    // 买鞋 on 2026-11-09: shopping's turn ran 354 tool steps after the last message, and the chat showed only that message.
    const rows = [...Array.from({ length: 60 }, (_, index) => text(index % 2 ? "bot" : "user")), text("user"), text(), ...steps(354)];
    const start = followWindowStart(rows, drawnTailStart(rows, TRANSCRIPT_WINDOW_SIZE));
    const window = resolveTranscriptWindow(rows, start, TRANSCRIPT_WINDOW_SIZE);
    expect(window.hiddenCount).toBe(0);
    expect(window.visible.filter((row) => row.kind === "text")).toHaveLength(62);
  });

  it("still windows a long chat at the size's worth of drawn rows", () => {
    const rows = [...Array.from({ length: 300 }, () => text()), ...steps(200)];
    expect(followWindowStart(rows, 0)).toBe(300 - TRANSCRIPT_WINDOW_SIZE);
  });
});
