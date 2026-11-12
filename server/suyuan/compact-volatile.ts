// suyuan fork: when Claude Code compacts a conversation in the middle of a turn, the rest of that turn still gets the
// turn's volatile half. The driver forgets that half at compact_boundary and re-sends it with the next turn
// (server/drivers/claude.ts); until then the compaction summary is all the model has of it, and since steady-prompt.ts
// that half also carries "user-profile" and "just-do-it". Claude Code runs SessionStart with source "compact" right
// after a compaction and takes a hook's plain stdout as context, which is how upstream re-sends the last digests
// (ingestEngineHook in server/index.ts).
// Claude Code keeps at most 10,000 characters of one hook's output; past that the model sees only a 2,000-character
// preview. The digests already use part of upstream's hook and the volatile half alone runs to about 9,000-13,000
// characters here, so the half goes out on hooks of its own: VOLATILE_SLOTS more SessionStart hooks, matched to
// "compact" only, each carrying one piece. The half re-sent is the one this conversation's running turn was given,
// found by the turn's hooks bearer (its thread and generation): another conversation's, or an earlier turn's, never.
// The next turn re-sends the half once more (the driver cannot tell), which costs one more copy.

export const VOLATILE_SLOTS = 3;
const SLOT_ARG = (slot: number) => `volatile-${slot}`;
/** Below Claude Code's 10,000 characters per hook output, header included. */
export const PIECE_CHARS = 9_500;
const KEPT_THREADS = 200;

type Hook = { type: string; command: string; args?: string[]; timeout?: number };

/** The extra SessionStart entries: the same helper, told which piece it asks for. */
export function volatileHookEntries(hook: Hook): Array<{ matcher: string; hooks: Hook[] }> {
  return Array.from({ length: VOLATILE_SLOTS }, (_, i) => ({
    matcher: "compact",
    hooks: [hook.args ? { ...hook, args: [...hook.args, SLOT_ARG(i + 1)] } : { ...hook, command: `${hook.command} ${SLOT_ARG(i + 1)}` }],
  }));
}

const held = new Map<string, { generation: string; volatile: string }>();

/** The volatile half a turn was given, by conversation and by the generation its hooks bearer carries. */
export function noteTurnVolatile(threadId: string, generation: string, volatile: string): void {
  held.delete(threadId);
  held.set(threadId, { generation, volatile });
  if (held.size > KEPT_THREADS) held.delete(held.keys().next().value!);
}

const header = (part: number, parts: number) =>
  `The conversation was just compacted, so here again is the part of your instructions that changes from turn to turn, as it stands for this turn${parts > 1 ? ` (part ${part} of ${parts})` : ""}. It replaces any earlier copy:\n\n`;
const HEADER_CHARS = header(VOLATILE_SLOTS, VOLATILE_SLOTS).length;

/** Whole lines where they fit; null when the half needs more pieces than there are hooks, so none of it is sent. */
export function volatilePieces(volatile: string): string[] | null {
  const budget = PIECE_CHARS - HEADER_CHARS;
  const pieces: string[] = [];
  let rest = volatile.trim();
  while (rest) {
    if (rest.length <= budget) { pieces.push(rest); break; }
    const cut = rest.lastIndexOf("\n", budget);
    const end = cut > 0 ? cut : budget;
    pieces.push(rest.slice(0, end));
    rest = rest.slice(end).replace(/^\n+/, "");
  }
  if (pieces.length > VOLATILE_SLOTS) return null;
  return pieces.map((piece, i) => header(i + 1, pieces.length) + piece);
}

/** A slot hook's answer, or null for upstream's hook (no slot). `active`: the bearer's turn is the running one. */
export function volatileHookReply(body: unknown, capability: { threadId: string; generation: string }, active: () => boolean): { ok: true; context?: string } | null {
  const event = body && typeof body === "object" ? (body as { event?: unknown; payload?: unknown; slot?: unknown }) : {};
  if (typeof event.slot !== "string") return null;
  const slot = Array.from({ length: VOLATILE_SLOTS }, (_, i) => i + 1).find((n) => SLOT_ARG(n) === event.slot);
  const payload = event.payload && typeof event.payload === "object" ? (event.payload as { source?: unknown }) : {};
  if (!slot || event.event !== "SessionStart" || payload.source !== "compact" || !active()) return { ok: true };
  const turn = held.get(capability.threadId);
  if (!turn || turn.generation !== capability.generation) return { ok: true };
  const piece = volatilePieces(turn.volatile)?.[slot - 1];
  return piece ? { ok: true, context: piece } : { ok: true };
}
