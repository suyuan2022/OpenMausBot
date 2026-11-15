// config.json edited outside the app is taken up without a restart: the config in memory changes in place, clients are told,
// a file that cannot be used changes nothing, the server's own saves are not edits, and engines are only replaced once
// nothing is running. The first half runs on the real config.ts (the suite's throwaway data folder); the engine half on a
// scripted host.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type AppConfig, DATA_DIR, engineLaunches, instanceConfigs, loadConfig, saveConfig } from "../config.ts";
import { type ConfigReload, type ConfigReloadHost, createConfigReload } from "./config-reload.ts";
import { watchConfigFile } from "./config-reload-host.ts";

const FILE = join(DATA_DIR, "config.json");
const write = (value: unknown) => writeFileSync(FILE, typeof value === "string" ? value : JSON.stringify(value, null, 2));
const onDisk = () => JSON.parse(readFileSync(FILE, "utf8")) as Record<string, unknown>;

describe("config.json edited outside the app, on the real config.ts", () => {
  let cfg: AppConfig;
  let reload: ConfigReload;
  let told: string[][];
  let working: boolean;
  let reloaded: number;

  beforeEach(() => {
    mkdirSync(DATA_DIR, { recursive: true });
    write({ everyBotRules: "old rules", profile: { name: "Suyuan", aboutMe: "old about" } });
    cfg = loadConfig();
    told = [];
    working = false;
    reloaded = 0;
    let busy = false;
    reload = watchConfigFile({
      cfg,
      engines: () => engineLaunches(instanceConfigs(cfg)),
      working: () => working,
      reloadEngines: async () => { reloaded += 1; },
      settings: { get: () => busy, set: (next) => { busy = next; } },
      changed: (keys) => { told.push([...keys]); },
    });
  });

  afterEach(() => {
    reload.stop();
    rmSync(FILE, { force: true });
  });

  it("says nothing on its first look when the file is what the server loaded", () => {
    reload.check();
    expect(told).toEqual([]);
  });

  it("takes up an edit in place and tells the clients which sections changed", () => {
    reload.check();
    const held = cfg;
    write({ everyBotRules: "new rules", profile: { name: "Suyuan", aboutMe: "old about" } });
    reload.check();
    expect(held.everyBotRules).toBe("new rules");
    expect(told).toEqual([["everyBotRules"]]);
    reload.check();
    expect(told, "the same file is not taken up twice").toHaveLength(1);
  });

  it("does nothing when the file is rewritten with the same text, or with the same settings in another layout", () => {
    reload.check();
    write({ everyBotRules: "old rules", profile: { name: "Suyuan", aboutMe: "old about" } });
    reload.check();
    write(JSON.stringify({ profile: { aboutMe: "old about", name: "Suyuan" }, everyBotRules: "old rules" }));
    reload.check();
    expect(told).toEqual([]);
    expect(cfg.everyBotRules).toBe("old rules");
  });

  it("keeps the loaded settings while the file is half-written or broken, and takes it up once it is whole", () => {
    reload.check();
    write('{ "everyBotRules": "new ru');
    reload.check();
    write("");
    reload.check();
    expect(cfg.everyBotRules).toBe("old rules");
    expect(cfg.profile?.name).toBe("Suyuan");
    expect(told).toEqual([]);
    write({ everyBotRules: "new rules", profile: { name: "Suyuan", aboutMe: "old about" } });
    reload.check();
    expect(cfg.everyBotRules).toBe("new rules");
    expect(told).toEqual([["everyBotRules"]]);
  });

  it("keeps the loaded settings when the file parses but is not a config the server accepts", () => {
    reload.check();
    write({ everyBotRules: 5, profile: { name: "Suyuan" } });
    reload.check();
    expect(cfg.everyBotRules).toBe("old rules");
    expect(told).toEqual([]);
  });

  it("drops what the edit removed: the rules, one profile field, a whole section", () => {
    reload.check();
    write({ profile: { name: "Suyuan" } });
    reload.check();
    expect(Object.hasOwn(cfg, "everyBotRules")).toBe(false);
    expect(cfg.profile).toEqual({ name: "Suyuan" });
    write({});
    reload.check();
    expect(Object.hasOwn(cfg, "profile")).toBe(false);
    expect(cfg.anthropic, "a section loadConfig() always fills in stays").toEqual(loadConfig().anthropic);
    expect(told).toEqual([["everyBotRules", "profile"], ["profile"]]);
  });

  it("does not count the server's own save as an edit", () => {
    reload.check();
    saveConfig({ everyBotRules: "saved in the app" });
    Object.assign(cfg, loadConfig());
    reload.check();
    expect(told).toEqual([]);
    expect(cfg.everyBotRules).toBe("saved in the app");
    // And the next outside edit is still seen.
    write({ ...onDisk(), everyBotRules: "edited again" });
    reload.check();
    expect(cfg.everyBotRules).toBe("edited again");
    expect(told).toEqual([["everyBotRules"]]);
  });

  it("still takes up an edit the server saved over before looking: the key it removed goes", () => {
    reload.check();
    write({ profile: { name: "Suyuan", aboutMe: "old about" } });
    saveConfig({ profile: { aboutMe: "from the app" } });
    Object.assign(cfg, loadConfig());
    expect(cfg.everyBotRules, "upstream's reload alone keeps the removed key").toBe("old rules");
    reload.check();
    expect(Object.hasOwn(cfg, "everyBotRules")).toBe(false);
    expect(cfg.profile?.aboutMe).toBe("from the app");
    expect(told).toEqual([["everyBotRules"]]);
  });

  it("replaces an engine whose launch settings were edited only once nothing is running", async () => {
    reload.check();
    working = true;
    write({ ...onDisk(), instances: { claude: { driver: "claude", environment: { OMB_CLAUDE_AUTOCOMPACT: "250000" } } } });
    reload.check();
    expect(cfg.instances?.claude?.environment).toEqual({ OMB_CLAUDE_AUTOCOMPACT: "250000" });
    expect(told).toEqual([["instances"]]);
    reload.check();
    expect(reloaded, "a running turn is never stopped for an outside edit").toBe(0);
    working = false;
    reload.check();
    await reload.settled();
    expect(reloaded).toBe(1);
    expect(told).toEqual([["instances"], ["instances"]]);
    reload.check();
    await reload.settled();
    expect(reloaded).toBe(1);
  });
});

describe("engines after an outside edit, on a scripted host", () => {
  let dir: string;
  let path: string;
  let cfg: Record<string, unknown>;
  let working: boolean;
  let settingsBusy: boolean;
  let calls: Array<Record<string, unknown>>;
  let busyDuringReload: boolean[];
  let logs: string[];
  let reload: ConfigReload;
  let fail: Error | null;

  const host = (): ConfigReloadHost<Record<string, unknown>> => ({
    path,
    cfg,
    load: () => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>,
    validate: (text) => { JSON.parse(text); },
    onSaved: () => () => {},
    engines: () => structuredClone((cfg.instances ?? {}) as Record<string, unknown>),
    working: () => working,
    reloadEngines: async (before) => {
      busyDuringReload.push(settingsBusy);
      calls.push(before);
      if (fail) throw fail;
    },
    settings: { get: () => settingsBusy, set: (busy) => { settingsBusy = busy; } },
    changed: () => {},
    log: (line) => { logs.push(line); },
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omb-config-reload-"));
    path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ instances: { claude: { environment: { A: "1" } } } }));
    cfg = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    working = false;
    settingsBusy = false;
    calls = [];
    busyDuringReload = [];
    logs = [];
    fail = null;
    reload = createConfigReload(host());
    reload.check();
  });

  afterEach(() => {
    reload.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const edit = (value: unknown) => writeFileSync(path, JSON.stringify(value));

  it("hands the replacement the launches from before the first unapplied edit, under the settings flag", async () => {
    working = true;
    edit({ instances: { claude: { environment: { A: "2" } } } });
    reload.check();
    edit({ instances: { claude: { environment: { A: "3" } } } });
    reload.check();
    expect(calls).toEqual([]);
    working = false;
    reload.check();
    await reload.settled();
    expect(calls).toEqual([{ claude: { environment: { A: "1" } } }]);
    expect(busyDuringReload).toEqual([true]);
    expect(settingsBusy, "the flag is released afterwards").toBe(false);
  });

  it("replaces nothing when the edit was undone before the engines went idle", async () => {
    working = true;
    edit({ instances: { claude: { environment: { A: "2" } } } });
    reload.check();
    edit({ instances: { claude: { environment: { A: "1" } } } });
    reload.check();
    working = false;
    reload.check();
    await reload.settled();
    expect(calls).toEqual([]);
  });

  it("leaves the file unread while a settings save is in flight", () => {
    settingsBusy = true;
    edit({ instances: { claude: { environment: { A: "2" } } }, everyBotRules: "new" });
    reload.check();
    expect(cfg.everyBotRules).toBeUndefined();
    settingsBusy = false;
    reload.check();
    expect(cfg.everyBotRules).toBe("new");
  });

  it("releases the settings flag and says so when the replacement fails", async () => {
    fail = new Error("engine would not start");
    edit({ instances: { claude: { environment: { A: "2" } } } });
    reload.check();
    await reload.settled();
    expect(settingsBusy).toBe(false);
    expect(logs.some((line) => line.includes("engine would not start"))).toBe(true);
  });

  it("logs a broken file once, without quoting it", () => {
    writeFileSync(path, '{ "anthropic": { "key": "sk-secret" ');
    reload.check();
    reload.check();
    const refused = logs.filter((line) => line.includes("not usable"));
    expect(refused).toHaveLength(1);
    expect(refused[0]).toContain("invalid JSON");
    expect(refused[0]).not.toContain("sk-secret");
  });
});
