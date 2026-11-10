// suyuan fork: on a phone, a tap on a bot's reply shows its buttons (src/components/MessageActions.tsx) beside the
// block that was tapped. A reply with tables is drawn as several blocks, bubbles and table cards (ReplyBlocks.tsx), with
// one set of buttons for all of them: wide-replies.css stands them in a column at the reply's right edge, at the bottom
// of a single bubble and beside the first block of a split reply. On a reply taller than the screen that place is off
// screen, so the tap seemed to do nothing (on a 402×874 phone a table reply's buttons stood 366px above the top of the
// screen). So the touch that shows them, a tap or a long press, moves the hidden column first: beside the block under
// the finger, level with the finger where the block is taller than the buttons. While they show, a tap on another block
// of the same reply moves them there; a tap on the block they stand beside hides them.

/** A touch screen the size of a phone: where wide-replies.css stands the buttons in a column. */
const TOUCH_PHONE = "(hover: none) and (pointer: coarse) and (max-width: 40rem)";
const TRAY = '[data-testid="message-actions"]';
/** A bot's reply: wide-replies.css lays out the column for these rows only. */
const BOT_ROW = "[data-message-row].items-start";
/** One block of a reply: a table card, or a bubble that is not the wrapper around a split reply's blocks. */
const BLOCK = "[data-reply-table], [data-chat-bubble]:not(:has([data-reply-blocks]))";

type Span = { top: number; bottom: number };

/** The block each column was last stood beside. */
const beside = new WeakMap<HTMLElement, Element>();

/** Where the column's top goes, in the page's coordinates: beside the block, inside the row. */
export function trayTop(fingerY: number, block: Span, row: Span, height: number): number | null {
  // A reply hardly taller than its buttons keeps them centred beside it, as wide-replies.css has them.
  if (row.bottom - row.top < height * 2) return null;
  // Centred on a block no taller than they are; level with the finger inside a taller one.
  const top = block.bottom - block.top <= height
    ? (block.top + block.bottom - height) / 2
    : Math.min(Math.max(fingerY - height / 2, block.top), block.bottom - height);
  return Math.min(Math.max(top, row.top), row.bottom - height);
}

function touched(target: EventTarget | null): { row: HTMLElement; tray: HTMLElement; block: Element } | null {
  if (!(target instanceof Element) || !matchMedia(TOUCH_PHONE).matches) return null;
  const row = target.closest<HTMLElement>(BOT_ROW);
  const tray = row?.querySelector<HTMLElement>(TRAY);
  if (!row || !tray || tray.contains(target)) return null;
  const block = target.closest(BLOCK);
  // A touch in the gap between two blocks is on the reply as a whole.
  return { row, tray, block: block && row.contains(block) ? block : row };
}

function stand(at: { row: HTMLElement; tray: HTMLElement; block: Element }, fingerY: number): void {
  const box = at.tray.offsetParent;
  if (!box) return;
  beside.set(at.tray, at.block);
  const top = trayTop(fingerY, at.block.getBoundingClientRect(), at.row.getBoundingClientRect(), at.tray.offsetHeight);
  if (top === null) {
    at.tray.style.removeProperty("top");
    at.tray.style.removeProperty("bottom");
    return;
  }
  at.tray.style.top = `${Math.round(top - box.getBoundingClientRect().top)}px`;
  at.tray.style.bottom = "auto";
}

function place(event: PointerEvent): void {
  if (event.pointerType !== "touch") return;
  const at = touched(event.target);
  // A column already showing waits until the touch turns out to be a tap: trayMoves() moves it then.
  if (!at || at.tray.dataset.shown) return;
  stand(at, event.clientY);
}

/** For the tap that would hide a reply's showing buttons (MessageActions.tsx): on another block of the reply they move
 * beside it and stay, and this is true; on the block they stand beside nothing moves, and the tap hides them. */
export function trayMoves(event: PointerEvent): boolean {
  if (event.pointerType !== "touch") return false;
  const at = touched(event.target);
  if (!at || !at.tray.dataset.shown || beside.get(at.tray) === at.block) return false;
  stand(at, event.clientY);
  return true;
}

export function installTrayAtFinger(doc: Document = document): () => void {
  // Capture: the row's own listener decides whether this touch shows the column, after it has moved.
  doc.addEventListener("pointerdown", place, true);
  return () => doc.removeEventListener("pointerdown", place, true);
}
