import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// suyuan fork (FORK.md): a deploy that finds the bots busy for 10 minutes leaves a copy of itself waiting, which installs
// once they are idle, wakes Maus 工程师 only when it installed or finally gave up, and steps aside for a newer deploy.
// Runs the real script against a stand-in HOME, curl, npm, launchctl and openmausbot.
const script = join(import.meta.dirname, "deploy-vm-remote.sh");
const hasZsh = spawnSync("zsh", ["-c", "true"]).status === 0;
const busyBots = JSON.stringify({ bots: [{ name: "荔枝", busy: true }] });
const idleBots = JSON.stringify({ bots: [{ name: "荔枝", busy: false }] });

let home = "";
const read = (name: string) => (existsSync(join(home, name)) ? readFileSync(join(home, name), "utf8") : "");
const waitingPid = () => Number(read(".openmausbot-releases/retry.pid").trim());
const alive = (pid: number) => pid > 0 && spawnSync("kill", ["-0", String(pid)]).status === 0;
afterEach(() => {
  if (!home) return;
  const pid = waitingPid();
  if (pid) spawnSync("kill", [String(pid)]);
  rmSync(home, { recursive: true, force: true });
});

function setUp(botsJson: string) {
  home = mkdtempSync(join(tmpdir(), "omb-deploy-"));
  const store = join(home, ".openmausbot-releases");
  const bin = join(home, ".npm-global", "bin");
  mkdirSync(store, { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(store, "wake-hook"), "http://127.0.0.1:1/hook");
  for (const version of [2, 3]) writeFileSync(join(store, `openmausbot-0.1.149-suyuan.${version}.tgz`), "");
  writeFileSync(join(home, "bots.json"), botsJson);
  const node = execFileSync("node", ["-p", "process.execPath"], { encoding: "utf8" }).trim();
  const fake = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  fake("node", `exec "${node}" "$@"`);
  fake("openmausbot", "echo 0.1.149-suyuan.1");
  fake("npm", `echo "npm $*" >> "${home}/npm.log"`);
  // The real launchctl would restart whatever server this machine runs.
  fake("launchctl", `echo "launchctl $*" >> "${home}/launchctl.log"`);
  fake("trash", "true");
  fake(
    "curl",
    `for a; do last="$a"; done
case "$last" in
  *api/bots*) cat "${home}/bots.json" ;;
  *hook) echo "$*" >> "${home}/wake.log" ;;
esac`,
  );
  return store;
}

function run(store: string, retryFor: number, version = 2) {
  return spawnSync("zsh", [script, "0", `.openmausbot-releases/openmausbot-0.1.149-suyuan.${version}.tgz`], {
    env: { HOME: home, PATH: `/usr/bin:/bin`, WAIT_TRIES: "2", WAIT_SECONDS: "0.1", WAKE_TRIES: "1", RETRY_FOR: String(retryFor) },
    encoding: "utf8",
    cwd: store,
  });
}

async function until(what: () => boolean) {
  for (let i = 0; i < 100 && !what(); i++) await new Promise((done) => setTimeout(done, 100));
  expect(what()).toBe(true);
}

describe.skipIf(!hasZsh)("deploy-vm-remote.sh", () => {
  it("goes on waiting after 10 busy minutes and installs once the bots are idle", async () => {
    const store = setUp(busyBots);
    const result = run(store, 60);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain("still busy after 10 minutes (荔枝). Nothing is installed yet");
    expect(read("wake.log")).toBe("");
    expect(read("npm.log")).toBe("");
    await until(() => alive(waitingPid()));

    writeFileSync(join(home, "bots.json"), idleBots);
    await until(() => read("wake.log").includes('"outcome":"installed"'));
    expect(read("npm.log")).toContain("openmausbot-0.1.149-suyuan.2.tgz");
    expect(read("launchctl.log")).toContain("kickstart");
    expect(read(".openmausbot-releases/deploy.log")).toContain("the bots are idle");
    expect(existsSync(join(store, "retry.pid"))).toBe(false);
  });

  it("wakes Maus 工程师 with not-installed only when the waiting runs out", async () => {
    const store = setUp(busyBots);
    expect(run(store, 1).status).toBe(3);
    await until(() => read("wake.log").includes('"outcome":"not-installed"'));
    expect(read(".openmausbot-releases/deploy.log")).toContain("Gave up; nothing was installed");
    expect(read("npm.log")).toBe("");
  });

  it("a newer deploy replaces the one still waiting", async () => {
    const store = setUp(busyBots);
    run(store, 60);
    await until(() => alive(waitingPid()));
    const earlier = waitingPid();

    const result = run(store, 60, 3);
    expect(result.stdout).toContain("stopped the earlier deploy that was still waiting");
    await until(() => !alive(earlier) && alive(waitingPid()));
    writeFileSync(join(home, "bots.json"), idleBots);
    await until(() => read("wake.log").includes('"outcome":"installed"'));
    expect(read("npm.log")).toContain("suyuan.3.tgz");
    expect(read("npm.log")).not.toContain("suyuan.2.tgz");
  });
});
