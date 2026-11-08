// suyuan fork: the update check asks this fork's releases and names its deploy script. These go red if a merge of
// upstream quietly puts the official release and npm command back.
import { describe, expect, it, vi } from "vitest";

import { createUpdateChecker, LATEST_RELEASE_URL, UPDATE_COMMANDS } from "./update-check.ts";

const release = (tag: string) =>
  ({ ok: true, status: 200, json: async () => ({ tag_name: tag, html_url: `https://github.com/suyuan2022/OpenMausBot/releases/tag/${tag}` }) }) as Response;

describe("update check on the suyuan fork", () => {
  it("asks the fork's releases and updates an npm install with the deploy script", () => {
    expect(LATEST_RELEASE_URL).toBe("https://api.github.com/repos/suyuan2022/OpenMausBot/releases/latest");
    expect(UPDATE_COMMANDS.npm).toEqual({ command: "cd ~/Documents/OpenMausBot && scripts/suyuan/deploy-vm.sh", restart: false });
  });

  it("reads suyuan-v tags, newer by upstream version first and then by fork build", async () => {
    const check = (tag: string, current: string) =>
      createUpdateChecker({ current, install: "npm", fetch: vi.fn(async () => release(tag)) })();
    expect(await check("suyuan-v0.1.150-suyuan.3", "0.1.149-suyuan.9")).toMatchObject({ available: true, latest: "0.1.150-suyuan.3" });
    expect(await check("suyuan-v0.1.149-suyuan.10", "0.1.149-suyuan.9")).toMatchObject({ available: true });
    expect(await check("suyuan-v0.1.149-suyuan.9", "0.1.149-suyuan.9")).toMatchObject({ available: false });
  });
});
