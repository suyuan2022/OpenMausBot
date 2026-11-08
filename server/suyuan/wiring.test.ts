// suyuan fork: the few lines in upstream files that plug the fork in. A daily merge of upstream that drops one of them
// would silently switch a feature off, since every other test only exercises the fork's own files; this one goes red.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const source = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** The text of `function name(` up to the next top-level function: enough to say a call sits inside it. */
function functionBody(text: string, name: string): string {
  const start = text.indexOf(`function ${name}(`);
  expect(start, `function ${name} is gone`).toBeGreaterThanOrEqual(0);
  const next = text.indexOf("\nfunction ", start + 1);
  return text.slice(start, next < 0 ? undefined : next);
}

describe("the fork's hooks into upstream files", () => {
  it("server/index.ts loads the fork and hands every broadcast frame to it", () => {
    const index = source("server/index.ts");
    expect(index).toContain('from "./suyuan/register.ts"');
    expect(functionBody(index, "broadcast")).toContain("suyuanFrame(payload)");
  });

  it("the app runs the push hook, shows its switch, and leaves notifications to push where it is on", () => {
    expect(functionBody(source("src/App.tsx"), "Shell")).toContain("useWebPush(state, dispatch)");
    expect(functionBody(source("src/components/NotificationSettingsRows.tsx"), "NotificationRows")).toContain("<WebPushRow />");
    expect(functionBody(source("src/lib/notify.ts"), "showNotification")).toContain("if (pushHandlesNotifications() && !frame.forPerson) return;");
  });
});
