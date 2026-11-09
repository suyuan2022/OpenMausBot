// suyuan fork: Safari's pinch fires gesturestart before it zooms the page, and touch-action alone has let one through
// in a home-screen web app; cancelling the event closes that gap. (no-zoom.css covers double tap and the rest.)
// The viewport's maximum-scale is set here at run time rather than in index.html, whose upstream test keeps it out of
// the page everyone gets (scripts/testing/web-app-assets.test.ts).
// Only on a touch screen: a Mac Safari trackpad pinch fires the same events, and desktop keeps its zoom.
export function installNoZoom(doc: Document = document): () => void {
  if (!window.matchMedia("(hover: none) and (pointer: coarse)").matches) return () => undefined;
  const stop = (event: Event) => event.preventDefault();
  doc.addEventListener("gesturestart", stop);
  doc.addEventListener("gesturechange", stop);
  const viewport = doc.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  const was = viewport?.getAttribute("content") ?? null;
  if (viewport && was !== null && !/maximum-scale/.test(was)) viewport.setAttribute("content", `${was}, maximum-scale=1`);
  return () => {
    doc.removeEventListener("gesturestart", stop);
    doc.removeEventListener("gesturechange", stop);
    if (viewport && was !== null) viewport.setAttribute("content", was);
  };
}
