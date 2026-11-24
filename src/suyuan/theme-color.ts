// suyuan fork (FORK.md): an installed web app's title bar (Chrome's app window on a computer) takes the page's
// theme-color, which index.html sets to near-black for every skin, so a light skin had a black bar over it. This keeps
// theme-color at the color the page is painted with, and repaints it when the skin changes. src/main.tsx imports this
// before it applies the skin, so the bar is right from the first paint.
import { subscribeSkin } from "@/lib/skins";

const META = 'meta[name="theme-color"]';

/** The page's own ground under the current skin, as the browser computes it; null while nothing opaque is painted. */
export function pageColor(doc: Document = document): string | null {
  for (const element of [doc.body, doc.documentElement]) {
    if (!element) continue;
    const color = getComputedStyle(element).backgroundColor;
    if (color && color !== "transparent" && !/^rgba\(.*,\s*0\)$/.test(color)) return color;
  }
  return null;
}

/** Keeps theme-color on the page's ground; returns what stops following the skin. */
export function installThemeColor(doc: Document = document): () => void {
  const paint = () => {
    const color = pageColor(doc);
    if (!color) return;
    let meta = doc.querySelector<HTMLMetaElement>(META);
    if (!meta) {
      meta = doc.createElement("meta");
      meta.name = "theme-color";
      doc.head.append(meta);
    }
    if (meta.content !== color) meta.content = color;
  };
  paint();
  return subscribeSkin(paint);
}

if (typeof document !== "undefined") installThemeColor();
