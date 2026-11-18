// suyuan fork: a Codex catalog file in ~/.codex/model-catalogs/<provider>.json with "replaces_official": true means
// this machine runs Codex only through that provider (here the team gateway "her"; the ChatGPT sign-in is not kept up).
// Then the official rows leave the picker, and a bare id such as "gpt-6.2-astra" (saved on a bot, or named by a bot
// when it opens a thread) starts on that provider instead of the expired ChatGPT login. Personal config, read per call.
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { codexHome } from "../drivers/codex-identity.ts";

const PROVIDER_ID = /^[a-z][a-z0-9_-]*$/i;

export interface OfficialAlias {
  provider: string;
  slugs: Set<string>;
}

export function codexOfficialAlias(env: Record<string, string | undefined> = process.env): OfficialAlias | null {
  const home = codexHome(env);
  if (!home) return null;
  const dir = join(home, "model-catalogs");
  let files: string[];
  try {
    files = readdirSync(dir).filter((file) => file.endsWith(".json")).sort();
  } catch {
    return null;
  }
  for (const file of files) {
    const provider = basename(file, ".json").replace(/-models$/, "");
    if (!PROVIDER_ID.test(provider)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || (parsed as { replaces_official?: unknown }).replaces_official !== true) continue;
    const models = (parsed as { models?: unknown }).models;
    const slugs = new Set<string>();
    if (Array.isArray(models)) {
      for (const row of models) {
        const slug = row && typeof row === "object" ? (row as { slug?: unknown; id?: unknown }).slug ?? (row as { id?: unknown }).id : row;
        if (typeof slug === "string" && slug) slugs.add(slug);
      }
    }
    return { provider, slugs };
  }
  return null;
}

/** The provider a bare (official) id runs on when an alias catalog is set and serves that slug. */
export function aliasProviderForBare(model: string, env?: Record<string, string | undefined>): string | null {
  const alias = codexOfficialAlias(env);
  return alias && alias.slugs.has(model) ? alias.provider : null;
}

/** "gpt-6.2-astra" → "her::gpt-6.2-astra" when the alias provider serves it; anything else unchanged. */
export function qualifyBareCodexModel(model: string, env?: Record<string, string | undefined>): string {
  if (model.includes("::")) return model;
  const provider = aliasProviderForBare(model, env);
  return provider ? `${provider}::${model}` : model;
}
