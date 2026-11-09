// suyuan fork: Safari's pinch fires gesturestart before it zooms the page, and touch-action alone has let one through
// in a home-screen web app; cancelling the event closes that gap. (No-zoom.css covers double tap and the rest.)
export function installNoZoom(doc: Document = document): () => void {
  const stop = (event: Event) => event.preventDefault();
  doc.addEventListener("gesturestart", stop);
  doc.addEventListener("gesturechange", stop);
  return () => {
    doc.removeEventListener("gesturestart", stop);
    doc.removeEventListener("gesturechange", stop);
  };
}
