// suyuan fork: config-reload.ts bound to the real config.json. server/index.ts hands over the parts only it has (the live
// config, the engines, what is running, how to tell the clients); the file's path, its validation and the server's own
// saves come from config.ts here, so that file's import list in index.ts stays as upstream wrote it.
import { join } from "node:path";

import { type AppConfig, DATA_DIR, loadConfig, onConfigSaved, parseStoredConfig } from "../config.ts";
import { parseJson } from "../schema.ts";
import { type ConfigReload, type ConfigReloadHost, startConfigReload } from "./config-reload.ts";

type FromIndex = Pick<ConfigReloadHost<AppConfig>, "cfg" | "engines" | "working" | "reloadEngines" | "settings" | "changed">;

export function watchConfigFile(host: FromIndex): ConfigReload {
  return startConfigReload<AppConfig>({
    ...host,
    path: join(DATA_DIR, "config.json"),
    load: loadConfig,
    validate: (text) => { parseStoredConfig(parseJson(text)); },
    onSaved: (listener) => onConfigSaved((before) => listener(before)),
    log: (line) => console.log(line),
  });
}
