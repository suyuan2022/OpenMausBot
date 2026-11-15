// suyuan fork: config.json edited outside the app (by hand, or by a bot with a file tool) takes effect without a restart.
// Upstream reads the file at startup and after its own saves, so an edit made outside sat unused until the service
// restarted, and the settings page kept showing the old values: saving there wrote them back over the edit. This looks at
// the file every two seconds and, once its text differs from what the server last took up, validates it, reloads the
// in-memory config in place and tells the clients, the way a save in the app does.
//
// Engines are the one part a save in the app applies by force: it stops every turn running on an engine whose launch
// settings changed. An edit made outside never stops a turn: the new settings wait until nothing is running, and the
// engines are replaced then.
import { readFileSync, statSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

export const CONFIG_RELOAD_EVERY_MS = 2_000;

export interface ConfigReloadHost<C extends object> {
  /** config.json's path. */
  path: string;
  /** The live config object every reader holds: changed in place, never replaced. */
  cfg: C;
  /** config.ts loadConfig(): the file as the server reads it, credentials from the environment included. */
  load(): C;
  /** Throws when the text is not a config the server would accept: JSON that parses and passes the stored-config schema. */
  validate(text: string): void;
  /** config.ts onConfigSaved(): the server's own writes, with the file as it was before each. */
  onSaved(listener: (before: unknown) => void): () => void;
  /** What each engine launches with, to tell which ones an edit changed. */
  engines(): Record<string, unknown>;
  /** A turn is running somewhere: replacing an engine now would stop it. */
  working(): boolean;
  /** Replaces the engines whose launch settings differ from `before`. */
  reloadEngines(before: Record<string, unknown>): Promise<void>;
  /** The app's single-flight flag for settings saves: a reload neither runs inside one nor lets one start inside it. */
  settings: { get(): boolean; set(busy: boolean): void };
  /** The config changed in memory: `keys` are the top-level sections that differ. */
  changed(keys: readonly string[]): void;
  log(line: string): void;
}

export interface ConfigReload {
  /** One look at the file. The timer calls it; a test calls it directly. */
  check(): void;
  /** Resolves once an engine replacement that check() started has finished. */
  settled(): Promise<void>;
  stop(): void;
}

type Seen = { stamp: string | null; text: string | null };

const changedIds = (before: Record<string, unknown>, after: Record<string, unknown>): string[] =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((id) => !isDeepStrictEqual(before[id], after[id]));

/** The file's identity, or null when it is missing. Unlike settledFileStamp, a file written this second still has one:
 * the text is compared next, so a stamp that failed to tick costs nothing worse than one more look. */
function fileStamp(path: string): string | null {
  try {
    const file = statSync(path, { bigint: true });
    return `${file.ino}:${file.size}:${file.mtimeNs}:${file.ctimeNs}`;
  } catch {
    return null;
  }
}

function fileText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function jsonOf(text: string | null): unknown {
  if (text === null) return {};
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return undefined;
  }
}

export function createConfigReload<C extends object>(host: ConfigReloadHost<C>): ConfigReload {
  // Nothing is known at first, so the first look compares the file with the config loaded at startup: an edit made while
  // the server was starting is taken up too.
  let seen: Seen = { stamp: null, text: null };
  let refusedStamp: string | null = null;
  /** Engine launches as they were before the first edit not yet applied to the engines. */
  let enginesBefore: Record<string, unknown> | null = null;
  let replacing: Promise<void> | null = null;

  const record = host.cfg as Record<string, unknown>;

  const unsubscribe = host.onSaved((before) => {
    // The server's own write is known text, not an edit. But a save merges its patch onto whatever is on disk: when the
    // file it started from is not the one last taken up, an outside edit is inside this write, and the next look must
    // still reload it (the saver's own Object.assign(cfg, loadConfig()) cannot drop a key the edit removed).
    if (!isDeepStrictEqual(before, jsonOf(seen.text))) return;
    seen = { stamp: fileStamp(host.path), text: fileText(host.path) };
  });

  function replaceEngines(): void {
    if (!enginesBefore || replacing || host.settings.get()) return;
    const ids = changedIds(enginesBefore, host.engines());
    if (!ids.length) { enginesBefore = null; return; }
    if (host.working()) return;
    const before = enginesBefore;
    enginesBefore = null;
    host.settings.set(true);
    replacing = host.reloadEngines(before)
      .then(() => {
        host.log(`config reload: engines now run the edited settings: ${ids.join(", ")}`);
        host.changed(["instances"]);
      }, (error) => {
        host.log(`config reload: could not replace engines ${ids.join(", ")}: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => { host.settings.set(false); replacing = null; });
  }

  function check(): void {
    // A settings save in flight checked its patch against the config in memory: leave both alone until it is done.
    if (host.settings.get()) return;
    takeUp();
    replaceEngines();
  }

  function takeUp(): void {
    const stamp = fileStamp(host.path);
    // A missing file changes nothing: the config in memory stays, as it does for upstream until the next save.
    if (stamp === null || stamp === seen.stamp) return;
    const text = fileText(host.path);
    if (text === null) return;
    if (text === seen.text) { seen = { stamp, text }; return; }
    try {
      host.validate(text);
    } catch (error) {
      // loadConfig() answers a file it cannot use with defaults, which here would wipe the running settings: a half-written
      // or broken file is left unread until it changes again. A parse error can quote the file, so only its kind is logged.
      if (refusedStamp !== stamp) {
        const reason = error instanceof SyntaxError ? "invalid JSON" : error instanceof Error ? error.message : "unreadable";
        host.log(`config reload: ${host.path} was edited but is not usable, keeping the loaded settings: ${reason}`);
      }
      refusedStamp = stamp;
      return;
    }
    const engines = host.engines();
    const fresh = host.load() as Record<string, unknown>;
    // load() read the file again: had it changed since it was validated, what it read is unchecked. The next look decides.
    if (fileStamp(host.path) !== stamp) return;
    refusedStamp = null;
    seen = { stamp, text };
    const keys = [...new Set([...Object.keys(record), ...Object.keys(fresh)])].filter((key) => !isDeepStrictEqual(record[key], fresh[key]));
    if (!keys.length) return;
    // In place, and whole: a key the edit removed must go too, which Object.assign alone would keep. loadConfig() fills in
    // every section it derives from the environment on each call, so nothing it owns is ever missing from `fresh`.
    for (const key of Object.keys(record)) if (!Object.hasOwn(fresh, key)) delete record[key];
    Object.assign(record, fresh);
    if (changedIds(engines, host.engines()).length) enginesBefore ??= engines;
    host.log(`config reload: ${host.path} was edited outside the app; now using its ${keys.join(", ")}`);
    host.changed(keys);
  }

  return {
    check,
    settled: () => replacing ?? Promise.resolve(),
    stop: unsubscribe,
  };
}

/** Starts the two-second look; a failure in one look is logged and the next one still runs. */
export function startConfigReload<C extends object>(host: ConfigReloadHost<C>): ConfigReload {
  const reload = createConfigReload(host);
  const timer = setInterval(() => {
    try {
      reload.check();
    } catch (error) {
      host.log(`config reload: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, CONFIG_RELOAD_EVERY_MS);
  timer.unref();
  return { ...reload, stop: () => { clearInterval(timer); reload.stop(); } };
}
