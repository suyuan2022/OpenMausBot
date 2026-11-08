// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "suyuan:last-frame";
const BUILD = "/assets/index-abc.js";
const view = () => ({ width: window.innerWidth, height: window.innerHeight });

/** The module lays its cover once src/main.tsx has run, in a microtask after it loads. */
async function fresh() {
  vi.resetModules();
  const module = await import("./last-frame");
  await Promise.resolve();
  return module;
}

const cover = () => document.getElementById("suyuan-last-frame");

beforeEach(() => {
  document.body.innerHTML = `<div id="root"></div><script type="module" src="${BUILD}"></script>`;
  localStorage.clear();
});

afterEach(() => {
  cover()?.remove();
});

describe("captureFrame and showFrame", () => {
  it("copies the app with its scroll offsets and leaves the live page untouched", async () => {
    const { captureFrame, showFrame } = await fresh();
    const root = document.getElementById("root")!;
    root.innerHTML = '<div class="chat" id="chat"><p>收工卡写好了</p></div>';
    const chat = root.querySelector<HTMLElement>(".chat")!;
    chat.scrollTop = 420;
    const frame = captureFrame(root, view(), 1000, BUILD);
    expect(frame.html).toContain('data-suyuan-scroll="420"');
    expect(chat.hasAttribute("data-suyuan-scroll")).toBe(false);

    const shown = showFrame(document, frame);
    const copy = shown.querySelector<HTMLElement>(".chat")!;
    expect(copy.scrollTop).toBe(420);
    expect(copy.id).toBe("");
    expect(shown.firstElementChild!.hasAttribute("inert")).toBe(true);
    expect(shown.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps nothing anyone typed, nor anything that could run, load a page or float without its backdrop", async () => {
    const { captureFrame } = await fresh();
    const root = document.getElementById("root")!;
    root.innerHTML = [
      '<input type="password" value="sk-secret-123"><textarea>草稿里的 key</textarea>',
      '<img src="blob:http://x/1" onerror="window.ran = 1"><img src="/api/bots/b/avatar">',
      '<script>window.ran = 2</script><base href="https://evil.test/"><meta http-equiv="refresh" content="0;url=https://evil.test">',
      '<iframe src="https://example.com"></iframe><dialog open>快捷键</dialog><b>ok</b>',
    ].join("");
    const { html } = captureFrame(root, view(), 0, BUILD);
    expect(html).not.toMatch(/sk-secret-123|草稿里的 key|blob:|onerror|script|base|meta|iframe|dialog|快捷键/);
    expect(html).toContain('<img src="/api/bots/b/avatar" fetchpriority="low">');
    expect(html).toContain("<b>ok</b>");
  });

  it("keeps the ids an SVG's gradients and clip paths point at", async () => {
    const { cleanMarkup } = await fresh();
    const html = cleanMarkup(document, '<div id="row"><svg id="omb-mermaid-1"><defs><linearGradient id="u-grad"></linearGradient></defs><path fill="url(#u-grad)"></path></svg></div>');
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
  const keepFrame = () => localStorage.setItem(KEY, JSON.stringify({ html: "<p>上次的画面</p>", ...view(), at: Date.now(), build: BUILD }));

  it("covers the page until the app says its bots have loaded", async () => {
    keepFrame();
    const { noteApp, liftFrame } = await fresh();
    expect(cover()?.textContent).toBe("上次的画面");
    noteApp(false);
    document.getElementById("root")!.innerHTML = "<main>connecting</main>";
    await Promise.resolve();
    expect(cover()).not.toBeNull();
    liftFrame();
    expect(cover()).toBeNull();
  });

  it("lifts at once and forgets the frame when the page is not the app", async () => {
    keepFrame();
    await fresh();
    document.getElementById("root")!.innerHTML = "<form>pairing</form>";
    await Promise.resolve();
    expect(cover()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("lifts by itself when the bots take too long", async () => {
    vi.useFakeTimers();
    try {
      keepFrame();
      const { HOLD_MS } = await fresh();
      expect(cover()).not.toBeNull();
      vi.advanceTimersByTime(HOLD_MS);
      expect(cover()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("keeping a frame", () => {
  it("keeps the loaded app when the page goes away, and nothing before it has loaded", async () => {
    const { noteApp } = await fresh();
    document.getElementById("root")!.innerHTML = "<p>对话</p>";
    noteApp(false);
    window.dispatchEvent(new Event("pagehide"));
    expect(localStorage.getItem(KEY)).toBeNull();
    noteApp(true);
    window.dispatchEvent(new Event("pagehide"));
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ html: "<p>对话</p>", build: BUILD, ...view() });
  });

  it("drops the old frame when the new one is too big or can't be stored, and when the session ends", async () => {
    const { noteApp, noteAppGone } = await fresh();
    const root = document.getElementById("root")!;
    noteApp(true);
    root.innerHTML = "<p>对话</p>";
    window.dispatchEvent(new Event("pagehide"));
    root.innerHTML = `<p>${"字".repeat(600_000)}</p>`;
    window.dispatchEvent(new Event("pagehide"));
    expect(localStorage.getItem(KEY)).toBeNull();

    root.innerHTML = "<p>对话</p>";
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
