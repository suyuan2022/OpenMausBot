// suyuan fork: the person reads the app in Simplified Chinese, and a key missing from zh.json shows up in English.
import { describe, expect, it } from "vitest";

import en from "../locales/en.json";
import zh from "../locales/zh.json";

const english = en as Record<string, string>;
const chinese = zh as Record<string, string>;
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe("Simplified Chinese pack", () => {
  it("translates every English key", () => {
    expect(Object.keys(english).filter((key) => !Object.hasOwn(chinese, key))).toEqual([]);
  });

  it("keeps each string's placeholders", () => {
    const broken = Object.keys(chinese)
      .filter((key) => Object.hasOwn(english, key))
      .filter((key) => placeholders(chinese[key]!).join(",") !== placeholders(english[key]!).join(","));
    expect(broken).toEqual([]);
  });
});
