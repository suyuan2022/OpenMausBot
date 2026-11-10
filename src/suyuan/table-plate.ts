/** A table card's copy, download and expand buttons wait on a computer for the pointer to rest on the card. A touch
 * screen has no pointer to rest, so a tap on the card stands in for it: the buttons show, and hide again on a second
 * tap, or when a tap lands outside the card. phone-tables.css hides the buttons unless this mark is on. A code block's
 * copy-and-more pill (CodeBlock.tsx) answers the same tap: phone-code.css hides it unless the mark is on.
 *
 * What counts as a tap is MessageActions.tsx's, so a card and the message around it answer the same touches: a quick
 * (under 450ms) touch that moved under 10px, not on a control, with no text selected. */
export const PLATE_SHOWN = "data-suyuan-plate";
/** What a tap shows the buttons of: a table card, a code block. */
const CARD = "[data-table-card], .chat-code-block";

// Copied from MessageActions.tsx, which keeps them private.
const INTERACTIVE = "a, button, input, textarea, select, summary, label, [role=button], [contenteditable=true]";
const LONG_PRESS_MS = 450;
const MOVE_PX = 10;

export function installTablePlate(): () => void {
  let press: { x: number; y: number; at: number } | null = null;
  const down = (event: PointerEvent) => {
    press = event.pointerType === "touch" ? { x: event.clientX, y: event.clientY, at: Date.now() } : null;
  };
  const move = (event: PointerEvent) => {
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > MOVE_PX) press = null;
  };
  const cancel = () => { press = null; };
  const up = (event: PointerEvent) => {
    if (!press || event.pointerType !== "touch") return;
    const quick = Date.now() - press.at < LONG_PRESS_MS;
    press = null;
    if (!quick) return;
    const target = event.target instanceof Element ? event.target : null;
    const card = target?.closest(CARD) ?? null;
    document.querySelectorAll(`[${PLATE_SHOWN}]`).forEach((open) => { if (open !== card) open.removeAttribute(PLATE_SHOWN); });
    if (!card || target!.closest(INTERACTIVE) || window.getSelection()?.toString()) return;
    card.toggleAttribute(PLATE_SHOWN);
  };
  document.addEventListener("pointerdown", down);
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
  document.addEventListener("pointercancel", cancel);
  return () => {
    document.removeEventListener("pointerdown", down);
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    document.removeEventListener("pointercancel", cancel);
  };
}
