import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const STATUS_SCRIPT = join(ROOT, "scripts/suyuan/status.mjs");
const MAX_LINE_CHARS = 260;

describe("FORK.md 结构兼容、防膨胀与状态脚本", () => {
  const doc = readFileSync(join(ROOT, "FORK.md"), "utf8");
  const lines = doc.split("\n");

  it.each([
    "## 保留的能力",
    "## 硬红线与仓库外依赖",
    "## 上游同步与跳过清单",
    "## 等夙愿真机确认",
    "## 近期要做",
    "## 碰到再说与长期专题",
    "## 已定论与退场记录",
  ])("保留 %s", (heading) => {
    expect(lines).toContain(heading);
  });

  it("单行不超过防膨胀上限，且外挂 docs/suyuan 链接有效", () => {
    const tooLong = lines
      .map((line, i) => ({ line: i + 1, len: line.length }))
      .filter((x) => x.len > MAX_LINE_CHARS);
    expect(tooLong).toEqual([]);

    const refs = [...doc.matchAll(/\((\.?\/?docs\/suyuan\/[^)\s]+)\)/g)].map((m) => m[1]);
    for (const rel of refs) {
      expect(existsSync(join(ROOT, rel))).toBe(true);
    }
  });

  it("准确识别超期(>14天)、刚好14天豁免、缺日期、无效日期，且不误报长期小节", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-fork-doc-"));
    try {
      const samplePath = join(dir, "FORK.md");
      writeFileSync(
        samplePath,
        [
          "## 上游同步与跳过清单",
          "- `[2026-10-01]` 跳过某上游卡片",
          "## 等夙愿真机确认",
          "- `[2026-11-10]` 超15天验证项",
          "- `[2026-11-11]` 刚好14天边界项",
          "- 漏写日期的验证项",
          "- `[2026-13-45]` 写错日期的验证项",
          "## 近期要做",
          "- `[2026-11-05]` 旧待清理项",
          "## 碰到再说与长期专题",
          "- `[2026-10-10]` 长期专题项",
          "## 已定论与退场记录",
          "- `[2026-10-01]` 早已定论",
        ].join("\n"),
      );
      const out = execFileSync(
        process.execPath,
        [STATUS_SCRIPT, "--offline", "--doc", samplePath, "--now", "2026-11-25", "--stale-days", "14"],
        { encoding: "utf8" },
      );
      expect(out).toContain("有 2 条挂超过 14 天");
      expect(out).toContain("超15天验证项");
      expect(out).toContain("旧待清理项");
      expect(out).not.toContain("刚好14天边界项");
      expect(out).not.toContain("长期专题项");
      expect(out).not.toContain("早已定论");
      expect(out).not.toContain("跳过某上游卡片");
      expect(out).toContain("缺 [YYYY-MM-DD] 日期");
      expect(out).toContain("漏写日期的验证项");
      expect(out).toContain("日期无效");
      expect(out).toContain("2026-13-45");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("非法参数或不存在的 --doc 直接报错退出", () => {
    for (const badArgs of [
      ["--offline", "--stale-days=abc"],
      ["--offline", "--stale-days", "-1"],
      ["--offline", "--now", "2026/11/25"],
      ["--offline", "--doc", "/nonexistent/FORK.md"],
      ["--offline", "--repo", tmpdir()],
    ]) {
      expect(() => execFileSync(process.execPath, [STATUS_SCRIPT, ...badArgs], { stdio: "pipe" })).toThrow();
    }
  });
});
