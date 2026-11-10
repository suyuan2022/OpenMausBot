// suyuan fork: a phone in Simple mode leads its home with the desk's tiles (Sidebar.tsx, `tiled`): the Chief and the
// pinned bots side by side, and no "Pinned" section in the list under them. A tile opens its bot's menu on a right click
// (SidebarTiles.tsx, onContextMenu), and iOS Safari sends no contextmenu event for a long press, so on a phone a tile
// had no way to its menu: unpinning a bot took a computer. Here a touch that rests on a tile for half a second sends the
// tile that event, and the click that follows the finger's lift is dropped, so the bot's chat does not open under the
// menu. A pinned tile is draggable for the desk's reorder, and iOS lifts a draggable thing under a long press: on a
// touch phone the tile stops being draggable at the touch, as the list's own drag is off there.

/** A touch screen the size of a phone, as in tray-at-finger.ts. */
const TOUCH_PHONE = "(hover: none) and (pointer: coarse) and (max-width: 40rem)";
const TILE = "[data-sidebar-tile]";
/** As long as the press that shows a message's buttons (MessageActions.tsx). */
const HOLD_MS = 500;
/** A finger that travels further than this is scrolling or swiping, not pressing. */
const SLOP_PX = 10;

const tileOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>(TILE) : null);

export function installTileMenu(doc: Document = document): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let start: { x: number; y: number } | null = null;
  let opened = false;
  const rest = () => {
    clearTimeout(timer);
    timer = undefined;
    start = null;
  };
  const down = (event: PointerEvent) => {
    rest();
    opened = false;
    if (event.pointerType !== "touch" || !matchMedia(TOUCH_PHONE).matches) return;
    const tile = tileOf(event.target);
    // A rename in progress keeps the touch for its text field.
    if (!tile || event.target instanceof HTMLInputElement) return;
    tile.setAttribute("draggable", "false");
    const at = (start = { x: event.clientX, y: event.clientY });
    timer = setTimeout(() => {
      rest();
      opened = true;
      tile.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y }));
    }, HOLD_MS);
  };
  const move = (event: PointerEvent) => {
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > SLOP_PX) rest();
  };
  const click = (event: MouseEvent) => {
    if (!opened) return;
    opened = false;
    if (!tileOf(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  // Capture: the tile's own click opens the chat, and must not hear the click that ends a long press.
  doc.addEventListener("pointerdown", down, true);
  doc.addEventListener("pointermove", move, true);
  doc.addEventListener("pointerup", rest, true);
  doc.addEventListener("pointercancel", rest, true);
  doc.addEventListener("click", click, true);
  return () => {
    rest();
    doc.removeEventListener("pointerdown", down, true);
    doc.removeEventListener("pointermove", move, true);
    doc.removeEventListener("pointerup", rest, true);
    doc.removeEventListener("pointercancel", rest, true);
    doc.removeEventListener("click", click, true);
  };
}
