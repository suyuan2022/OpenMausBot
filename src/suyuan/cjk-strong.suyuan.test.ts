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
});
