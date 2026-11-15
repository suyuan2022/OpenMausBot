import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// suyuan fork (FORK.md): a deploy that gives up waiting for busy bots still wakes Maus 工程师, so a release that never
// went in does not pass for installed. Runs the real script against a stand-in HOME, curl and openmausbot.
const script = join(import.meta.dirname, "deploy-vm-remote.sh");
const hasZsh = spawnSync("zsh", ["-c", "true"]).status === 0;

let home = "";
afterEach(() => home && rmSync(home, { recursive: true, force: true }));

function setUp(botsJson: string) {
  home = mkdtempSync(join(tmpdir(), "omb-deploy-"));
  const store = join(home, ".openmausbot-releases");
  const bin = join(home, ".npm-global", "bin");
  mkdirSync(store, { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(store, "wake-hook"), "http://127.0.0.1:1/hook");
  writeFileSync(join(home, "bots.json"), botsJson);
  const node = execFileSync("node", ["-p", "process.execPath"], { encoding: "utf8" }).trim();
  const fake = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  fake("node", `exec "${node}" "$@"`);
  fake("openmausbot", "echo 0.1.149-suyuan.1");
  fake("npm", `echo "npm $*" >> "${home}/npm.log"`);
  fake(
    "curl",
    `for a; do last="$a"; done
case "$last" in
  *api/bots*) cat "${home}/bots.json" ;;
  *hook) echo "$*" >> "${home}/wake.log" ;;
esac`,
  );
  return { store, bin };
}

function run(store: string) {
  return spawnSync("zsh", [script, "0", ".openmausbot-releases/openmausbot-0.1.149-suyuan.2.tgz"], {
    env: { HOME: home, PATH: `/usr/bin:/bin`, WAIT_TRIES: "2", WAIT_SECONDS: "0", WAKE_TRIES: "1" },
    encoding: "utf8",
    cwd: store,
  });
}

describe.skipIf(!hasZsh)("deploy-vm-remote.sh", () => {
  it("wakes Maus 工程师 with not-installed when the bots stay busy", () => {
    const { store } = setUp(JSON.stringify({ bots: [{ name: "荔枝", busy: true }] }));
    const result = run(store);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain("still busy after 10 minutes (荔枝). Nothing was installed");
    expect(readFileSync(join(home, "wake.log"), "utf8")).toContain('"outcome":"not-installed"');
    expect(() => readFileSync(join(home, "npm.log"))).toThrow();
  });
});
