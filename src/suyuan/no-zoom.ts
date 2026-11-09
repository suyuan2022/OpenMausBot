// suyuan fork: Safari's pinch fires gesturestart before it zooms the page, and touch-action alone has let one through
// in a home-screen web app; cancelling the event closes that gap. (no-zoom.css covers double tap and the rest.)
// Only on a touch screen: a Mac Safari trackpad pinch fires the same events, and desktop keeps its zoom.
export function installNoZoom(doc: Document = document): () => void {
  if (!window.matchMedia("(hover: none) and (pointer: coarse)").matches) return () => undefined;
  const stop = (event: Event) => event.preventDefault();
  doc.addEventListener("gesturestart", stop);
  doc.addEventListener("gesturechange", stop);
  return () => {
    doc.removeEventListener("gesturestart", stop);
    doc.removeEventListener("gesturechange", stop);
  };
}
