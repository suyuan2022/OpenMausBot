import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { decodeCodexSelection, readCodexModelCatalog } from "../drivers/codex-catalog.ts";
import { codexOfficialAlias, qualifyBareCodexModel } from "./codex-official-alias.ts";

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function codexHomeWith(replaces: boolean): string {
  const home = mkdtempSync(join(tmpdir(), "codex-alias-"));
  homes.push(home);
  mkdirSync(join(home, "model-catalogs"));
  writeFileSync(join(home, "config.toml"), 'model = "gpt-6-astra"\nmodel_provider = "her"\n\n[model_providers.her]\nname = "her-gateway"\n');
  writeFileSync(join(home, "model-catalogs", "her.json"), JSON.stringify({
    ...(replaces ? { replaces_official: true } : {}),
    models: [
      { slug: "gpt-6.2-astra", display_name: "GPT-6.2 Astra (her-gateway)" },
      { slug: "gpt-6-astra", display_name: "GPT-6 Astra (her-gateway)" },
    ],
  }));
  return home;
}

const noFetch = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;

describe("codex official alias", () => {
  it("does nothing without replaces_official", () => {
    const env = { CODEX_HOME: codexHomeWith(false) };
    expect(codexOfficialAlias(env)).toBeNull();
    expect(qualifyBareCodexModel("gpt-6.2-astra", env)).toBe("gpt-6.2-astra");
  });

  it("qualifies bare ids the alias provider serves, leaves others", () => {
    const env = { CODEX_HOME: codexHomeWith(true) };
    expect(qualifyBareCodexModel("gpt-6.2-astra", env)).toBe("her::gpt-6.2-astra");
    expect(qualifyBareCodexModel("gpt-5.5", env)).toBe("gpt-5.5");
    expect(qualifyBareCodexModel("her::gpt-6-astra", env)).toBe("her::gpt-6-astra");
  });

  it("routes a bare id to the alias provider at launch", () => {
    const previous = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHomeWith(true);
    try {
      expect(decodeCodexSelection("gpt-6.2-astra")).toEqual({ model: "gpt-6.2-astra", modelProvider: "her" });
      expect(decodeCodexSelection("gpt-5.5")).toEqual({ model: "gpt-5.5", modelProvider: "openai" });
    } finally {
      if (previous === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previous;
    }
  });

  it("hides the official rows from the picker", async () => {
    const env = { CODEX_HOME: codexHomeWith(true) };
    const catalog = await readCodexModelCatalog(env, noFetch);
    expect(catalog.options.every((option) => option.custom)).toBe(true);
    expect(catalog.options.map((option) => option.id)).toContain("her::gpt-6.2-astra");
    expect(catalog.default).toBe("her::gpt-6-astra");
  });

  it("keeps the official rows without the flag", async () => {
    const env = { CODEX_HOME: codexHomeWith(false) };
    const catalog = await readCodexModelCatalog(env, noFetch);
    expect(catalog.options.some((option) => !option.custom)).toBe(true);
  });
});
