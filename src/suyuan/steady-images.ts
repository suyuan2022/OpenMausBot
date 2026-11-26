/** suyuan fork (11-26): scrolling up through a chat, a picture that finished loading above the screen pushed what he was
 * reading down: an image tile (AttachmentThumbnail) waits as a 4:3 box and takes the picture's own shape once it loads,
 * and a picture in a reply has no height until it loads. The chat scrollers turn the browser's scroll anchoring off
 * (ChatView.tsx, GroupView.tsx: [overflow-anchor:none]) and use-transcript-viewport.ts puts the row back only when it
 * draws more rows, not when a row grows later. "滚动的时候页面会闪", on his Mac's Safari.
 *
 * Here, a picture or tile in a chat that changes height while its top is above the scroller's top moves the scroll by
 * the same amount, so what is on screen stays put. One below the top changes nothing on screen above it. */
export const SCROLLER = ".glass-scroller";
/** AttachmentThumbnail's box, and any picture in a chat (a reply's markdown, a widget) outside one. */
const WATCHED = "span.group\\/image, img";

/** The scroll that keeps the screen still when `box` changed height by `delta`. */
export function steadyScroll(scroller: Element, box: Element, delta: number): number | null {
  if (delta === 0) return null;
  if (box.getBoundingClientRect().top >= scroller.getBoundingClientRect().top) return null;
  return scroller.scrollTop + delta;
}

export function installSteadyImages(): () => void {
  if (typeof ResizeObserver === "undefined" || typeof MutationObserver === "undefined") return () => {};
  const heights = new WeakMap<Element, number>();
  const watched = new WeakSet<Element>();
  const sizes = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const box = entry.target;
      const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
      const before = heights.get(box);
      heights.set(box, height);
      if (before === undefined || !box.isConnected) continue;
      const scroller = box.closest(SCROLLER);
      if (!scroller) continue;
      const top = steadyScroll(scroller, box, height - before);
      if (top !== null) scroller.scrollTop = top;
    }
  });
  const watch = (root: ParentNode) => {
    for (const box of root.querySelectorAll(`${SCROLLER} :is(${WATCHED})`)) {
      // A tile's own picture fills the tile: the tile is the one that changes height.
      if (watched.has(box) || (box.tagName === "IMG" && box.closest("span.group\\/image"))) continue;
      watched.add(box);
      sizes.observe(box);
    }
  };
  const added = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(WATCHED) && node.closest(SCROLLER)) watch(node.parentElement ?? node);
        else watch(node);
      }
    }
  });
  watch(document);
  added.observe(document.body, { childList: true, subtree: true });
  return () => {
    added.disconnect();
    sizes.disconnect();
  };
}
