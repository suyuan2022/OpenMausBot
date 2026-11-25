// suyuan fork: bold that Markdown's own rule leaves as stars in Chinese. A closing "**" right after a punctuation mark and
// right before a character ("**晚上照常：**21:00"), or an opening one between a character and a punctuation mark
// ("这是**「重点」**吗"), does not count as a delimiter, so the reply showed the stars. After parsing, a "**…**" left in a
// text node that holds a Chinese character becomes bold. Code, inline code and math are never touched.
type Node = { type: string; value?: string; children?: Node[] };

const STRONG = /\*\*(?=[^\s*])([^\n]*?[^\s*])\*\*/g;
const CHINESE = /[㐀-鿿豈-﫿　-〿＀-￯]/;
const SKIPPED = new Set(["code", "inlineCode", "math", "inlineMath", "html"]);

/** The text's "**…**" spans with a Chinese character inside as bold; null when there is none. */
export function strongSpans(value: string): Node[] | null {
  const out: Node[] = [];
  let at = 0;
  for (const match of value.matchAll(STRONG)) {
    const inner = match[1]!;
    if (!CHINESE.test(inner)) continue;
    if (match.index > at) out.push({ type: "text", value: value.slice(at, match.index) });
    out.push({ type: "strong", children: [{ type: "text", value: inner }] });
    at = match.index + match[0].length;
  }
  if (at === 0) return null;
  if (at < value.length) out.push({ type: "text", value: value.slice(at) });
  return out;
}

function visit(node: Node): void {
  if (!node.children) return;
  node.children = node.children.flatMap((child) => {
    if (child.type === "text" && child.value?.includes("**")) return strongSpans(child.value) ?? [child];
    if (!SKIPPED.has(child.type)) visit(child);
    return [child];
  });
}

export function remarkCjkStrong() {
  return (tree: Node) => visit(tree);
}
