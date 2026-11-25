import type { ModelCatalog, ModelVariantOption, SendTurnInput } from "../contracts.ts";

const ARGON = "gemini-4-argon";
const HIGH = ARGON + "-high";
const MEDIUM = ARGON + "-medium";

export function visibleThinkingLevels(driver: string, model: string, levels: { options: ModelVariantOption[]; currentValue?: string }) {
  if (driver !== "antigravityAgent" || !/^gemini-4-argon(?:-(?:low|medium|high))?$/.test(model)) return levels;
  const { currentValue, options } = levels;
  return { options: options.filter((level) => level.id !== "high"), ...(currentValue && currentValue !== "high" ? { currentValue } : {}) };
}

/** The model list without High for argon, so the picker does not offer a level that is never run. */
export function withoutArgonHigh(catalog: ModelCatalog): ModelCatalog {
  if (!catalog.options.some((option) => option.id === HIGH || (option.id === ARGON && option.variants?.some((variant) => variant.id === "high")))) return catalog;
  const options = catalog.options.filter((option) => option.id !== HIGH).map((option) => option.id === ARGON && option.variants
    ? { ...option, variants: option.variants.filter((variant) => variant.id !== "high") }
    : option);
  return {
    ...catalog,
    options,
    default: catalog.default === HIGH ? options.find((option) => option.id === ARGON || option.id === MEDIUM)?.id ?? options[0]?.id ?? "" : catalog.default,
  };
}

/** An argon turn at High, at no level, or under the retired `gemini-4-argon-high` id runs at Medium. The same object
 * comes back when nothing changes, which is how the caller tells. */
export function argonAtMostMedium(turn: SendTurnInput, offeredModels: readonly string[]): SendTurnInput {
  if (turn.model === HIGH) {
    if (!offeredModels.includes(ARGON) && offeredModels.includes(MEDIUM)) return { ...turn, model: MEDIUM, variant: undefined };
    return { ...turn, model: ARGON, variant: "medium" };
  }
  if (turn.model !== ARGON || turn.variant === "medium" || turn.variant === "low") return turn;
  return { ...turn, variant: "medium" };
}
