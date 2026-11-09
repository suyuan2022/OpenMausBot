// suyuan fork: on a phone, a tap on a bot's reply shows its buttons (src/components/MessageActions.tsx) level with the
// finger. wide-replies.css stands them in a column at the reply's right edge, at its bottom, and a reply split around a
// table beside its first block: on a reply taller than the screen that edge is off screen, so the tap seemed to do
// nothing (on a 402×874 phone a table reply's buttons stood 366px above the top of the screen). The touch that shows
// them, a tap or a long press, moves the hidden column first; one already shown stays where it is and hides.

/** A touch screen the size of a phone: where wide-replies.css stands the buttons in a column. */
const TOUCH_PHONE = "(hover: none) and (pointer: coarse) and (max-width: 40rem)";
const TRAY = '[data-testid="message-actions"]';
/** A bot's reply: wide-replies.css lays out the column for these rows only. */
const BOT_ROW = "[data-message-row].items-start";

/** Where the column's top goes, in the page's coordinates: centred on the finger, inside the row. */
export function trayTop(fingerY: number, row: { top: number; bottom: number }, height: number): number | null {
  // A reply hardly taller than its buttons keeps them centred beside it, as wide-replies.css has them.
  if (row.bottom - row.top < height * 2) return null;
  return Math.min(Math.max(fingerY - height / 2, row.top), row.bottom - height);
}

function place(event: PointerEvent): void {
  if (event.pointerType !== "touch" || !(event.target instanceof Element)) return;
  const row = event.target.closest<HTMLElement>(BOT_ROW);
  const tray = row?.querySelector<HTMLElement>(TRAY);
  if (!row || !tray || tray.dataset.shown || tray.contains(event.target) || !matchMedia(TOUCH_PHONE).matches) return;
  const box = tray.offsetParent;
  if (!box) return;
  const top = trayTop(event.clientY, row.getBoundingClientRect(), tray.offsetHeight);
  if (top === null) {
    tray.style.removeProperty("top");
    tray.style.removeProperty("bottom");
    return;
  }
  tray.style.top = `${Math.round(top - box.getBoundingClientRect().top)}px`;
  tray.style.bottom = "auto";
}

export function installTrayAtFinger(doc: Document = document): () => void {
  // Capture: the row's own listener decides whether this touch shows the column, after it has moved.
  doc.addEventListener("pointerdown", place, true);
  return () => doc.removeEventListener("pointerdown", place, true);
}
