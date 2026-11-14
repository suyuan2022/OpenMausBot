// @vitest-environment happy-dom
// suyuan fork: an installed app's title bar follows the page's ground, not index.html's near-black.
import { afterEach, describe, expect, it } from "vitest";

import { wearSkin } from "@/lib/skins";
import { installThemeColor, pageColor } from "./theme-color";

const meta = () => document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
let stop = () => {};

function page() {
  document.head.innerHTML = '<meta name="theme-color" content="#070707">'
    + '<style>[data-skin="daylight"] body { background-color: rgb(245, 241, 235); } [data-skin="midnight"] body { background-color: rgb(18, 18, 18); }</style>';
}

afterEach(() => {
  stop();
  document.head.innerHTML = "";
  delete document.documentElement.dataset.skin;
});

describe("the title bar color", () => {
  it("takes the light skin's ground instead of the near-black index.html sets", () => {
    page();
    wearSkin("daylight");
    stop = installThemeColor();
    expect(meta()?.content).toBe("rgb(245, 241, 235)");
  });

  it("follows the skin when it changes", () => {
    page();
    wearSkin("daylight");
    stop = installThemeColor();
    wearSkin("midnight");
    expect(meta()?.content).toBe("rgb(18, 18, 18)");
  });

  it("leaves the color alone while nothing opaque is painted", () => {
    document.head.innerHTML = '<meta name="theme-color" content="#070707">';
    expect(pageColor()).toBeNull();
    stop = installThemeColor();
    expect(meta()?.content).toBe("#070707");
  });
});
