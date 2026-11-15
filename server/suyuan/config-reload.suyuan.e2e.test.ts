// suyuan fork: config.json edited outside the app takes effect without a restart, on one real server (config-reload.ts).
// The settings the app reads follow the file within seconds; a file that does not parse changes nothing; and what the app
// then saves is written over the edited file, not over the copy the server started with.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

import { launchVerificationServer } from "../../scripts/control-omb.ts";
import { hostTimeout } from "../testing/host-timeout.ts";

it("reads config.json again when it changes on disk, keeps the old settings through a broken file, and saves over the new one", async () => {
  const session = await launchVerificationServer({ ...process.env });
  const { url, dataDir } = session.info;
  try {
    const file = join(dataDir, "config.json");
    const api = async (method: string, body?: unknown) => {
      const response = await fetch(`${url}/api/config`, { method, headers: { "content-type": "application/json", origin: url },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000) });
      return { status: response.status, body: await response.json() as any };
    };
    const rules = async () => (await api("GET")).body.everyBotRules;
    const onDisk = () => JSON.parse(readFileSync(file, "utf8"));
    expect(await rules() ?? "").toBe("");
    // Edited by hand: no restart, no save in the app.
    writeFileSync(file, JSON.stringify({ ...onDisk(), everyBotRules: "RULE-ONE: answer in Chinese." }, null, 2));
    await expect.poll(rules, { timeout: 15_000, interval: 500 }).toBe("RULE-ONE: answer in Chinese.");
    // Half-written or broken: nothing changes.
    const good = readFileSync(file, "utf8");
    writeFileSync(file, good.slice(0, good.length / 2));
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    expect(await rules()).toBe("RULE-ONE: answer in Chinese.");
    writeFileSync(file, JSON.stringify({ ...JSON.parse(good), everyBotRules: "RULE-TWO: short answers." }, null, 2));
    await expect.poll(rules, { timeout: 15_000, interval: 500 }).toBe("RULE-TWO: short answers.");
    // The app saves another setting: the rules from the file survive, in memory and on disk.
    const saved = await api("PATCH", { computerName: "Probe" });
    expect(saved.status, JSON.stringify(saved.body)).toBeLessThan(300);
    expect(await rules()).toBe("RULE-TWO: short answers.");
    expect(onDisk()).toMatchObject({ everyBotRules: "RULE-TWO: short answers.", computerName: "Probe" });
    // Removed from the file: gone in the app too.
    const { everyBotRules: _gone, ...rest } = onDisk();
    writeFileSync(file, JSON.stringify(rest, null, 2));
    await expect.poll(async () => await rules() ?? "", { timeout: 15_000, interval: 500 }).toBe("");
  } finally {
    await session.close();
  }
}, hostTimeout(120_000));
