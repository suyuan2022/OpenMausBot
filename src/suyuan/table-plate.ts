/** A table card's copy, download and expand buttons wait on a computer for the pointer to rest on the card. A touch
 * screen has no pointer to rest, so a tap on the card stands in for it: the buttons show, and show again hidden on a
 * second tap, or when a tap lands outside the card. phone-tables.css hides the buttons unless this mark is on. */
export const PLATE_SHOWN = "data-suyuan-plate";

export function installTablePlate(): () => void {
  const onClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    const card = target?.closest("[data-table-card]") ?? null;
    document.querySelectorAll(`[data-table-card][${PLATE_SHOWN}]`).forEach((open) => { if (open !== card) open.removeAttribute(PLATE_SHOWN); });
    // A tap on a button or the search box is that control's, not a request to show or hide the buttons.
    if (!card || target!.closest("button, input, a")) return;
    card.toggleAttribute(PLATE_SHOWN);
  };
  document.addEventListener("click", onClick);
  return () => document.removeEventListener("click", onClick);
}
