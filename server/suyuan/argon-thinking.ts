// suyuan fork: gemini-4-argon runs at Medium at most. On High it writes its thinking into the reply: Antigravity sends
// every word as agent_message_chunk, not one agent_thought_chunk, and its own transcript has the thinking inside the
// reply text with no separate field, so nothing downstream can tell the two apart. The thinking opens with a mark the
// model makes up as it goes ("💡 Thought", "🫧thought", "सिस्टम/thought:", "[-thought-]"), and once one reply leaks
// the rest of the turn copies it (13 in a row on 2026-11-15). Antigravity's transcripts up to 2026-11-15: argon on
// High leaked 19 of 293 replies, argon on Medium 0 of 54, gemini-4-carbon on High 0 of 18; on 2026-11-15 an isolated
// instance leaked within one turn of switching argon to High. So High is not offered for argon, and a selection that
// still says High, or says no level, runs at Medium. Other Gemini models are left alone. The reply filter in
// shared/suyuan/thought-leak.ts stays as the net under this.
import type { ModelCatalog, SendTurnInput } from "../contracts.ts";

const ARGON = "gemini-4-argon";

/** The model list without High for argon, so the picker does not offer a level that is never run. */
export function withoutArgonHigh(catalog: ModelCatalog): ModelCatalog {
  if (!catalog.options.some((option) => option.id === ARGON && option.variants?.some((variant) => variant.id === "high"))) return catalog;
  return {
    ...catalog,
    options: catalog.options.map((option) => option.id === ARGON && option.variants
      ? { ...option, variants: option.variants.filter((variant) => variant.id !== "high") }
      : option),
  };
}

/** An argon turn at High, at no level, or under the retired `gemini-4-argon-high` id runs at Medium. The same object
 * comes back when nothing changes, which is how the caller tells. */
export function argonAtMostMedium(turn: SendTurnInput, offeredModels: readonly string[]): SendTurnInput {
  if (turn.model === `${ARGON}-high` && offeredModels.includes(ARGON)) return { ...turn, model: ARGON, variant: "medium" };
  if (turn.model !== ARGON || turn.variant === "medium" || turn.variant === "low") return turn;
  return { ...turn, variant: "medium" };
}
