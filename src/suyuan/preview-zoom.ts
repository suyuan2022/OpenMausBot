// suyuan fork: the page itself no longer pinch-zooms (no-zoom.ts), so the open image preview does it on its own: two
// fingers scale the picture 1–5×, one finger pans it once it is larger, a double tap flips between 1× and 2.5×. The
// state lives per <img>, and the preview draws a new one for each picture and drops it on close, so every picture
// opens at 1× and closing resets it. The preview box already clips overflow, so a transform is all it takes.
const PREVIEW_IMG = '[role="dialog"][aria-modal="true"] img.object-contain';
const MAX = 5;
const TAPPED = 2.5;
const DOUBLE_TAP_MS = 300;
const TAP_SLOP_PX = 20;

interface View { scale: number; x: number; y: number }
const views = new WeakMap<HTMLImageElement, View>();
const viewOf = (img: HTMLImageElement): View => views.get(img) ?? { scale: 1, x: 0, y: 0 };

function apply(img: HTMLImageElement, next: View): void {
  // Keep the picture over the box: it may be panned only as far as its enlarged edge.
  const limitX = (img.offsetWidth * (next.scale - 1)) / 2;
  const limitY = (img.offsetHeight * (next.scale - 1)) / 2;
  const view = { scale: next.scale, x: Math.max(-limitX, Math.min(limitX, next.x)), y: Math.max(-limitY, Math.min(limitY, next.y)) };
  views.set(img, view);
  img.style.transform = view.scale === 1 ? "" : `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
}

const spread = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

function previewImage(target: EventTarget | null): HTMLImageElement | null {
  if (!(target instanceof Element) || target.closest("button, a")) return null;
  const dialog = target.closest<HTMLElement>('[role="dialog"][aria-modal="true"]');
  return dialog?.querySelector<HTMLImageElement>(PREVIEW_IMG) ?? null;
}

export function installPreviewZoom(doc: Document = document): () => void {
  let img: HTMLImageElement | null = null;
  let pinch: { distance: number; scale: number } | null = null;
  let pan: { x: number; y: number; from: View } | null = null;
  let lastTap: { at: number; x: number; y: number } | null = null;
  let moved = false;

  const start = (event: TouchEvent) => {
    const hit = previewImage(event.target);
    if (!hit) return;
    img = hit;
    moved = false;
    const view = viewOf(hit);
    if (event.touches.length === 2) {
      pinch = { distance: spread(event.touches[0]!, event.touches[1]!), scale: view.scale };
      pan = null;
    } else if (event.touches.length === 1) {
      const { clientX: x, clientY: y } = event.touches[0]!;
      pan = { x, y, from: view };
    }
  };

  const move = (event: TouchEvent) => {
    if (!img || !img.isConnected) return;
    if (pinch && event.touches.length === 2) {
      event.preventDefault();
      moved = true;
      const scale = Math.min(MAX, Math.max(1, (pinch.scale * spread(event.touches[0]!, event.touches[1]!)) / pinch.distance));
      const view = viewOf(img);
      apply(img, { ...view, scale });
    } else if (pan && event.touches.length === 1) {
      const { clientX: x, clientY: y } = event.touches[0]!;
      if (Math.hypot(x - pan.x, y - pan.y) > TAP_SLOP_PX) moved = true;
      if (pan.from.scale === 1 && viewOf(img).scale === 1) return;
      event.preventDefault();
      apply(img, { scale: viewOf(img).scale, x: pan.from.x + x - pan.x, y: pan.from.y + y - pan.y });
    }
  };

  const end = (event: TouchEvent) => {
    if (!img || !img.isConnected) return;
    if (event.touches.length === 1 && pinch) {
      // One finger stays down after a pinch: carry on as a pan from here.
      const { clientX: x, clientY: y } = event.touches[0]!;
      pan = { x, y, from: viewOf(img) };
      pinch = null;
      return;
    }
    if (event.touches.length > 0) return;
    const wasPinch = pinch !== null;
    pinch = null;
    pan = null;
    const touch = event.changedTouches[0];
    if (wasPinch || moved || !touch) {
      lastTap = null;
      return;
    }
    const now = event.timeStamp;
    if (lastTap && now - lastTap.at < DOUBLE_TAP_MS && Math.hypot(touch.clientX - lastTap.x, touch.clientY - lastTap.y) < TAP_SLOP_PX) {
      apply(img, { scale: viewOf(img).scale > 1 ? 1 : TAPPED, x: 0, y: 0 });
      lastTap = null;
    } else {
      lastTap = { at: now, x: touch.clientX, y: touch.clientY };
    }
  };

  const options = { passive: false } as const;
  doc.addEventListener("touchstart", start, options);
  doc.addEventListener("touchmove", move, options);
  doc.addEventListener("touchend", end, options);
  return () => {
    doc.removeEventListener("touchstart", start);
    doc.removeEventListener("touchmove", move);
    doc.removeEventListener("touchend", end);
  };
}
