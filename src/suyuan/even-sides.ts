// suyuan fork: Simple mode's room header centres the name pill on the screen (src/components/RoomHeader.tsx), between an
// empty column on the left and the controls on the right. Once the name ran long the grid's right column kept the
// controls' width and the left one gave way, so the pill slid left of the middle. With both side columns at least as wide
// as the controls, a long name truncates in the middle instead.

/** The controls' ref: their row's `--suyuan-side` follows their width, and the row's side columns start from it. */
export function evenSides(controls: HTMLElement | null): (() => void) | undefined {
  const row = controls?.parentElement;
  if (!controls || !row) return undefined;
  const measure = () => row.style.setProperty("--suyuan-side", `${controls.getBoundingClientRect().width}px`);
  measure();
  if (typeof ResizeObserver !== "function") return undefined;
  const observer = new ResizeObserver(measure);
  observer.observe(controls);
  return () => observer.disconnect();
}
