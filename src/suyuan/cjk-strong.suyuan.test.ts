import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatMarkdown } from "@/components/ChatMarkdown";

const render = (text: string) => renderToStaticMarkup(createElement(ChatMarkdown, { text }));

describe("Chinese bold in a reply", () => {
  it("is bold when the closing stars follow a punctuation mark and precede a character", () => {
    const html = render("**晚上照常：**21:00 开始");
    expect(html).toContain("<strong>晚上照常：</strong>21:00 开始");
    expect(html).not.toContain("**");
  });

  it("is bold when the stars wrap quotes between characters", () => {
    const html = render("这是**「重点」**吗");
    expect(html).toContain("这是<strong>「重点」</strong>吗");
  });

  it("keeps what Markdown already made bold, and the stars in code", () => {
    expect(render("先**看**这里")).toContain("先<strong>看</strong>这里");
    const code = render("写成 `**粗体：**1` 就行");
    expect(code).toContain("<code");
    expect(code).toContain("**粗体：**1");
  });

  it("leaves English stars alone", () => {
    expect(render("2 ** 3 ** 4")).toContain("2 ** 3 ** 4");
  });

  it("is bold when a link stands between the stars", () => {
    const html = render("这是**「[参考](https://example.com/ref)」**吗");
    expect(html).toMatch(/这是<strong>「<a [^>]*href="https:\/\/example.com\/ref"[^>]*>参考<\/a>」<\/strong>吗/);
    expect(html).not.toContain("**");
  });

  it("is bold around inline code, and again for a second span after it", () => {
    const html = render("先**「`pnpm build`」**再**「`pnpm lint`」**");
    expect(html).toMatch(/先<strong>「<code[^>]*>pnpm build<\/code>」<\/strong>再<strong>「<code[^>]*>pnpm lint<\/code>」<\/strong>/);
  });

  it("bolds two quoted phrases joined by one character as two, not the character between them", () => {
    expect(render("把**「设置」**和**「通知」**都打开")).toContain("把<strong>「设置」</strong>和<strong>「通知」</strong>都打开");
  });

  it("pairs a line's left-over stars in order, a Markdown bold beside them untouched", () => {
    expect(render("**晚上照常：**21:00，**明天**再说")).toContain("<strong>晚上照常：</strong>21:00，<strong>明天</strong>再说");
  });

  it("keeps one escaped star a star and still bolds the rest of the line", () => {
    const html = render("转义星号 \\*，然后按**「设置」**继续");
    expect(html).toContain("转义星号 *，然后按<strong>「设置」</strong>继续");
  });

  it("leaves a bold written with underscores as it is, and splits two bold quotes around a link", () => {
    expect(render("把**「设置」__和__「通知」**都打开")).toContain("<strong>和</strong>");
    const linked = render("把**「设置」**和**[「通知」](https://example.com/notice)**都打开");
    expect(linked).toMatch(/把<strong>「设置」<\/strong>和<strong><a [^>]*>「通知」<\/a><\/strong>都打开/);
  });

  it("keeps stars written escaped as stars", () => {
    expect(render("\\*\\*中文\\*\\*")).toContain("**中文**");
    expect(render("\\*\\*中文\\*\\*")).not.toContain("<strong>");
  });
});
