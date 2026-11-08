// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "suyuan:last-frame";
const view = () => ({ width: window.innerWidth, height: window.innerHeight });

async function fresh() {
  vi.resetModules();
  return import("./last-frame");
}

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  localStorage.clear();
});

afterEach(() => {
  document.getElementById("suyuan-last-frame")?.remove();
});

describe("captureFrame and showFrame", () => {
  it("copies the app with its scroll offsets and leaves the live page untouched", async () => {
    const { captureFrame, showFrame } = await fresh();
    const root = document.getElementById("root")!;
    root.innerHTML = '<div class="chat" id="chat"><p>收工卡写好了</p></div>';
    const chat = root.querySelector<HTMLElement>(".chat")!;
    chat.scrollTop = 420;
    const frame = captureFrame(root, view(), 1000);
    expect(frame.html).toContain('data-suyuan-scroll="420"');
    expect(chat.hasAttribute("data-suyuan-scroll")).toBe(false);

    const cover = showFrame(document, frame);
    const copy = cover.querySelector<HTMLElement>(".chat")!;
    expect(copy.scrollTop).toBe(420);
    expect(copy.id).toBe("");
    expect(cover.firstElementChild!.hasAttribute("inert")).toBe(true);
    expect(cover.getAttribute("aria-hidden")).toBe("true");
  });

  it("leaves out anything in the kept markup that could run", async () => {
    const { showFrame } = await fresh();
    const cover = showFrame(document, {
      html: '<img src="x" onerror="window.ran = 1"><script>window.ran = 2</script><iframe src="https://example.com"></iframe><b>ok</b>',
      ...view(), at: 0,
    });
    expect(cover.querySelector("script, iframe")).toBeNull();
    expect(cover.querySelector("img")!.hasAttribute("onerror")).toBe(false);
    expect(cover.textContent).toBe("ok");
  });
});

describe("usableFrame", () => {
  const frame = { html: "<b>hi</b>", width: 390, height: 844, at: 1_000 };
  it("takes a recent frame taken at this window size, and nothing else", async () => {
    const { usableFrame } = await fresh();
    const size = { width: 390, height: 844 };
    expect(usableFrame(JSON.stringify(frame), size, 2_000)).toEqual(frame);
    expect(usableFrame(JSON.stringify(frame), size, 1_000 + 4 * 24 * 3600_000)).toBeNull();
    expect(usableFrame(JSON.stringify(frame), { width: 844, height: 390 }, 2_000)).toBeNull();
    expect(usableFrame("{ not json", size, 2_000)).toBeNull();
    expect(usableFrame(null, size, 2_000)).toBeNull();
  });
});

describe("a start with a kept frame", () => {
  const keepFrame = () => localStorage.setItem(KEY, JSON.stringify({ html: "<p>上次的画面</p>", ...view(), at: Date.now() }));

  it("covers the page until the app says its bots have loaded", async () => {
    keepFrame();
    const { noteApp, liftFrame } = await fresh();
    expect(document.getElementById("suyuan-last-frame")?.textContent).toBe("上次的画面");
    noteApp(false);
    document.getElementById("root")!.innerHTML = "<main>connecting</main>";
    await Promise.resolve();
    expect(document.getElementById("suyuan-last-frame")).not.toBeNull();
    liftFrame();
    expect(document.getElementById("suyuan-last-frame")).toBeNull();
  });

  it("lifts at once and forgets the frame when the page is not the app", async () => {
    keepFrame();
    await fresh();
    document.getElementById("root")!.innerHTML = "<form>pairing</form>";
    await Promise.resolve();
    expect(document.getElementById("suyuan-last-frame")).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("lifts by itself when the bots take too long", async () => {
    vi.useFakeTimers();
    try {
      keepFrame();
      const { HOLD_MS } = await fresh();
      vi.advanceTimersByTime(HOLD_MS);
      expect(document.getElementById("suyuan-last-frame")).toBeNull();
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
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ html: "<p>对话</p>", ...view() });
  });
});
