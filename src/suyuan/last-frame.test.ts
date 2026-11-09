// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/lib/i18n";

const KEY = "suyuan:last-frame";
const BUILD = "/assets/index-abc.js";
const view = () => ({ width: window.innerWidth, height: window.innerHeight });
/** A bot list beside a chat whose transcript scrolls, as src/components/ChatView.tsx lays it out. */
const CHAT = '<div class="side"><p>荔枝</p></div><div class="scroller" style="overflow-y: auto"><div role="log"><p class="line">收工卡写好了</p></div></div>';

/** The module lays its cover once src/main.tsx has run, in a microtask after it loads. */
async function fresh() {
  vi.resetModules();
  const module = await import("./last-frame");
  await Promise.resolve();
  return module;
}

const cover = () => document.getElementById("suyuan-last-frame");
/** Lifted: fading out, letting taps through to the page. */
const lifting = () => cover()?.style.opacity === "0" && cover()?.style.pointerEvents === "none";
/** The page shows whatever matches `selector` mid-screen. */
const pointAt = (selector: string) => vi.spyOn(document, "elementFromPoint").mockImplementation(() => document.querySelector(selector));
const hide = () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  document.body.innerHTML = `<div id="root"></div><script type="module" src="${BUILD}"></script>`;
  localStorage.clear();
});

afterEach(() => {
  cover()?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("captureFrame and showFrame", () => {
  it("copies the app with its chat at the end and every other scroller at its top, and leaves the live page untouched", async () => {
    const { captureFrame, chatInView, showFrame } = await fresh();
    const root = document.getElementById("root")!;
    root.innerHTML = `${CHAT}<button title="${t("chat.jumpToLatest")}">↓</button>`;
    const side = root.querySelector<HTMLElement>(".side")!;
    const scroller = root.querySelector<HTMLElement>(".scroller")!;
    side.scrollTop = 420;
    scroller.scrollTop = 100;
    pointAt(".line");
    const chat = chatInView(document, view())!;
    expect(chat).toBe(scroller);

    const frame = captureFrame(root, chat, view(), 1000, BUILD);
    expect(frame.html).toContain("data-suyuan-end");
    expect(frame.html).not.toContain("<button");
    expect(scroller.hasAttribute("data-suyuan-end")).toBe(false);
    expect(root.querySelector("button")).not.toBeNull();

    vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(900);
    const shown = showFrame(document, frame);
    expect(shown.querySelector<HTMLElement>(".side")!.scrollTop).toBe(0);
    expect(shown.querySelector<HTMLElement>(".scroller")!.scrollTop).toBe(900);
    expect(shown.firstElementChild!.hasAttribute("inert")).toBe(true);
    expect(shown.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps only the chat rows within two screens of its end, the ones the copy can show", async () => {
    const { captureFrame } = await fresh();
    const root = document.getElementById("root")!;
    // Each row is a `display: contents` wrapper, as in src/components/ChatView.tsx.
    root.innerHTML = '<div class="scroller"><div role="log">'
      + ["300", "599", "700", "1000"].map((bottom) => `<div class="contents"><p data-bottom="${bottom}">第 ${bottom} 行</p></div>`).join("")
      + "</div></div>";
    vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
      return (this.classList.contains("contents") ? [] : [{}]) as unknown as DOMRectList;
    });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const bottom = Number(this.getAttribute("data-bottom") ?? 0);
      return { top: 0, bottom, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
    const { html } = captureFrame(root, root.querySelector<HTMLElement>(".scroller")!, view(), 0, BUILD);
    expect(html).not.toMatch(/第 300 行|第 599 行/);
    expect(html).toMatch(/第 700 行[\s\S]*第 1000 行/);
    expect(root.querySelector("[data-suyuan-out-of-sight]")).toBeNull();
  });

  it("finds the chat only when it is what the screen shows mid-screen, at its latest messages", async () => {
    const { chatInView } = await fresh();
    const root = document.getElementById("root")!;
    root.innerHTML = CHAT;
    const scroller = root.querySelector(".scroller");
    pointAt(".line");
    expect(chatInView(document, view())).toBe(scroller);
    // A short chat leaves the middle of its scroller empty.
    pointAt(".scroller");
    expect(chatInView(document, view())).toBe(scroller);
    pointAt(".side p");
    expect(chatInView(document, view())).toBeNull();
    pointAt(".nothing");
    expect(chatInView(document, view())).toBeNull();
    // Opened around an older message, the chat ends in a button that loads the later ones.
    root.querySelector('[role="log"]')!.insertAdjacentHTML("beforeend", `<button>${t("chat.showLater", { count: 12 })}</button>`);
    pointAt(".line");
    expect(chatInView(document, view())).toBeNull();
  });

  it("keeps nothing anyone typed, nor anything that could run, load a page or float without its backdrop", async () => {
    const { cleanMarkup } = await fresh();
    const html = cleanMarkup(document, [
      '<input type="password" value="sk-secret-123"><textarea>草稿里的 key</textarea>',
      '<img src="blob:http://x/1" onerror="window.ran = 1"><img src="/api/bots/b/avatar">',
      '<script>window.ran = 2</script><base href="https://evil.test/"><meta http-equiv="refresh" content="0;url=https://evil.test">',
      '<iframe src="https://example.com"></iframe><dialog open>快捷键</dialog><input value="未标类型"><input type="range" value="12"><b>ok</b>',
    ].join("")).innerHTML;
    expect(html).not.toMatch(/sk-secret-123|草稿里的 key|未标类型|blob:|onerror|script|base|meta|iframe|dialog|快捷键/);
    expect(html).toContain('<input type="range" value="12">');
    expect(html).toContain('<img src="/api/bots/b/avatar" fetchpriority="low">');
    expect(html).toContain("<b>ok</b>");
  });

  it("keeps the ids an SVG's gradients and clip paths point at", async () => {
    const { cleanMarkup } = await fresh();
    const html = cleanMarkup(document, '<div id="row"><svg id="omb-mermaid-1"><defs><linearGradient id="u-grad"></linearGradient></defs><path fill="url(#u-grad)"></path></svg></div>').innerHTML;
    expect(html).toContain('<svg id="omb-mermaid-1">');
    expect(html).toContain('id="u-grad"');
    expect(html).not.toContain('id="row"');
  });
});

describe("usableFrame", () => {
  const frame = { html: "<b>hi</b>", width: 390, height: 844, at: 1_000, build: BUILD };
  it("takes a recent frame from this build, taken at this window size, and nothing else", async () => {
    const { usableFrame } = await fresh();
    const size = { width: 390, height: 844 };
    expect(usableFrame(JSON.stringify(frame), size, 2_000, BUILD)).toEqual(frame);
    expect(usableFrame(JSON.stringify(frame), size, 2_000, "/assets/index-new.js")).toBeNull();
    expect(usableFrame(JSON.stringify(frame), size, 1_000 + 4 * 24 * 3600_000, BUILD)).toBeNull();
    expect(usableFrame(JSON.stringify(frame), { width: 844, height: 390 }, 2_000, BUILD)).toBeNull();
    expect(usableFrame("{ not json", size, 2_000, BUILD)).toBeNull();
    expect(usableFrame(null, size, 2_000, BUILD)).toBeNull();
  });
});

describe("a start with a kept frame", () => {
  const keepFrame = (html = "<p>上次的画面</p>") => localStorage.setItem(KEY, JSON.stringify({ html, ...view(), at: Date.now(), build: BUILD }));

  it("covers the page until the app says its bots have loaded, then fades out", async () => {
    vi.useFakeTimers();
    try {
      keepFrame();
      const { noteApp, liftFrame, FADE_MS } = await fresh();
      expect(cover()?.textContent).toBe("上次的画面");
      noteApp(false, true);
      document.getElementById("root")!.innerHTML = "<main>connecting</main>";
      await Promise.resolve();
      expect(cover()).not.toBeNull();
      expect(lifting()).toBe(false);
      liftFrame();
      expect(lifting()).toBe(true);
      vi.advanceTimersByTime(FADE_MS);
      expect(cover()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the frame's chat at its end while fonts and pictures make it taller, until it lifts", async () => {
    const watching: { resized: () => void; disconnected: boolean }[] = [];
    vi.stubGlobal("ResizeObserver", class {
      entry = { resized: () => {}, disconnected: false };
      constructor(resized: () => void) {
        this.entry.resized = resized;
        watching.push(this.entry);
      }
      observe() {}
      disconnect() {
        this.entry.disconnected = true;
      }
    });
    const height = vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(500);
    keepFrame('<div class="scroller" data-suyuan-end=""><div role="log">对话</div></div>');
    const { liftFrame } = await fresh();
    const chat = cover()!.querySelector<HTMLElement>(".scroller")!;
    expect(chat.scrollTop).toBe(500);
    height.mockReturnValue(800);
    watching[0].resized();
    expect(chat.scrollTop).toBe(800);
    liftFrame();
    expect(watching[0].disconnected).toBe(true);
  });

  it("takes the frame off at once and forgets it when the page is not the app", async () => {
    keepFrame();
    await fresh();
    document.getElementById("root")!.innerHTML = "<form>pairing</form>";
    await Promise.resolve();
    expect(cover()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("forgets the frame on the pairing page, so pairing again never shows the last session", async () => {
    keepFrame();
    history.pushState(null, "", "/pair");
    try {
      await fresh();
      expect(cover()).toBeNull();
      expect(localStorage.getItem(KEY)).toBeNull();
    } finally {
      history.pushState(null, "", "/");
    }
  });

  it("shows no frame when a notification opened the app, which then goes to that conversation", async () => {
    keepFrame();
    history.pushState(null, "", "/?pushBot=b1&pushThread=t1");
    try {
      await fresh();
      expect(cover()).toBeNull();
      expect(localStorage.getItem(KEY)).not.toBeNull();
    } finally {
      history.pushState(null, "", "/");
    }
  });

  it("lifts by itself when the bots take too long", async () => {
    vi.useFakeTimers();
    try {
      keepFrame();
      const { HOLD_MS } = await fresh();
      expect(cover()).not.toBeNull();
      vi.advanceTimersByTime(HOLD_MS);
      expect(lifting()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("keeping a frame", () => {
  it("keeps the loaded app when the page goes away on a chat, and nothing before it has loaded", async () => {
    const { noteApp } = await fresh();
    document.getElementById("root")!.innerHTML = CHAT;
    pointAt(".line");
    noteApp(false, true);
    window.dispatchEvent(new Event("pagehide"));
    expect(localStorage.getItem(KEY)).toBeNull();
    noteApp(true, true);
    hide();
    const kept = JSON.parse(localStorage.getItem(KEY)!);
    expect(kept).toMatchObject({ build: BUILD, ...view() });
    expect(kept.html).toContain("收工卡写好了");
  });

  it("forgets the frame when the page goes away on anything but the chat alone, which the app does not reopen on", async () => {
    const { noteApp } = await fresh();
    document.getElementById("root")!.innerHTML = CHAT;
    const kept = () => localStorage.getItem(KEY) !== null;
    noteApp(true, true);
    pointAt(".line");
    hide();
    expect(kept()).toBe(true);
    // The bot list fills the screen.
    pointAt(".side p");
    hide();
    expect(kept()).toBe(false);
    pointAt(".line");
    window.dispatchEvent(new Event("pagehide"));
    expect(kept()).toBe(true);
    // A side panel is open beside the chat.
    noteApp(true, false);
    window.dispatchEvent(new Event("pagehide"));
    expect(kept()).toBe(false);
  });

  it("drops the old frame when the new one is too big or can't be stored, and when the session ends", async () => {
    const { noteApp, noteAppGone } = await fresh();
    const root = document.getElementById("root")!;
    noteApp(true, true);
    pointAt(".line");
    root.innerHTML = CHAT;
    window.dispatchEvent(new Event("pagehide"));
    root.innerHTML = CHAT.replace("收工卡写好了", "字".repeat(600_000));
    window.dispatchEvent(new Event("pagehide"));
    expect(localStorage.getItem(KEY)).toBeNull();

    root.innerHTML = CHAT;
    window.dispatchEvent(new Event("pagehide"));
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    try {
      window.dispatchEvent(new Event("pagehide"));
      expect(localStorage.getItem(KEY)).toBeNull();
    } finally {
      setItem.mockRestore();
    }

    window.dispatchEvent(new Event("pagehide"));
    expect(localStorage.getItem(KEY)).not.toBeNull();
    noteAppGone();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
