// suyuan fork: bold that Markdown's own rule leaves as stars in Chinese. A closing "**" right after a punctuation mark and
// right before a character ("**晚上照常：**21:00"), or an opening one between a character and a punctuation mark
// ("这是**「重点」**吗"), does not count as a delimiter, so the reply showed the stars. After parsing, the "**" left in a
// paragraph's text pair up in the order they come, also across a link or inline code ("这是**「[参考](./ref)」**吗"), and
// a pair whose words hold a Chinese character, neither starting nor ending with a space, becomes bold. Stars written
// escaped ("\*\*") stay stars, and code, inline code and math are never touched.
type Node = { type: string; value?: string; children?: Node[]; position?: { start: { offset?: number }; end: { offset?: number } } };
type Star = { node: number; at: number };

const CHINESE = /[㐀-鿿豈-﫿　-〿＀-￯]/;
const SKIPPED = new Set(["code", "inlineCode", "math", "inlineMath", "html"]);

const textOf = (node: Node): string => node.value ?? node.children?.map(textOf).join("") ?? "";

/** What lies between two stars, or null when a line break does. */
function between(children: Node[], open: Star, close: Star): string | null {
  const value = (index: number) => children[index]!.value!;
  if (open.node === close.node) return value(open.node).slice(open.at + 2, close.at);
  const middle = children.slice(open.node + 1, close.node);
  if (middle.some((node) => node.type === "break")) return null;
  return value(open.node).slice(open.at + 2) + middle.map(textOf).join("") + value(close.node).slice(0, close.at);
}

/** `children` with each bold pair of left-over stars made a strong node; the same array when there is none. */
function pairStars(children: Node[], asWritten: Set<Node>): Node[] {
  const stars: Star[] = [];
  children.forEach((node, index) => {
    if (node.type !== "text" || asWritten.has(node)) return;
    for (let at = node.value!.indexOf("**"); at >= 0; at = node.value!.indexOf("**", at + 2)) stars.push({ node: index, at });
  });
  const opens = new Set<Star>(), closes = new Set<Star>();
  for (let index = 0; index + 1 < stars.length; index++) {
    const inner = between(children, stars[index]!, stars[index + 1]!);
    if (inner === null || !CHINESE.test(inner) || /^[\s*]|[\s*]$|\n/.test(inner)) continue;
    opens.add(stars[index]!);
    closes.add(stars[index + 1]!);
    index++;
  }
  if (!opens.size) return children;
  const out: Node[] = [];
  let strong: Node[] | null = null;
  const put = (node: Node) => (strong ?? out).push(node);
  children.forEach((node, index) => {
    const marks = stars.filter((star) => star.node === index && (opens.has(star) || closes.has(star)));
    if (!marks.length) return put(node);
    let from = 0;
    for (const star of marks) {
      if (star.at > from) put({ type: "text", value: node.value!.slice(from, star.at) });
      if (opens.has(star)) strong = [];
      else {
        out.push({ type: "strong", children: strong! });
        strong = null;
      }
      from = star.at + 2;
    }
    if (from < node.value!.length) put({ type: "text", value: node.value!.slice(from) });
  });
  return out;
}

const CLOSING = /[」』）】〉》〕〗”’）］｝]$/;
const OPENING = /^[「『（【〈《〔〖“‘（［｛]/;

/** "**「设置」**和**「通知」**": Markdown pairs the stars around "和", between a closing and an opening bracket, and leaves
 * the outer two as text. A bold like that, with left-over stars before and after it, goes back to its stars, so all four
 * pair up as written. */
function unpaired(children: Node[], asWritten: Set<Node>): Node[] {
  const stars = (node: Node) => node.type === "text" && !asWritten.has(node) && node.value!.includes("**");
  const out: Node[] = [];
  children.forEach((node, index) => {
    const before = children[index - 1], after = children[index + 1];
    const misread = node.type === "strong" && before?.type === "text" && after?.type === "text"
      && CLOSING.test(before.value!) && OPENING.test(after.value!)
      && children.slice(0, index).some(stars) && children.slice(index + 1).some(stars);
    if (misread) out.push({ type: "text", value: "**" }, ...node.children!, { type: "text", value: "**" });
    else out.push(node);
  });
  return out;
}

/** The node's own source holds an escaped star: its stars were written to show. */
function escaped(node: Node, source: string | undefined): boolean {
  const start = node.position?.start.offset, end = node.position?.end.offset;
  return source !== undefined && start !== undefined && end !== undefined && source.slice(start, end).includes("\\*");
}

function visit(node: Node, source: string | undefined): void {
  if (!node.children) return;
  const asWritten = new Set<Node>();
  for (const child of node.children) {
    if (child.type === "text") {
      if (child.value?.includes("**") && escaped(child, source)) asWritten.add(child);
    } else if (!SKIPPED.has(child.type)) visit(child, source);
  }
  node.children = pairStars(unpaired(node.children, asWritten), asWritten);
}

export function remarkCjkStrong() {
  return (tree: Node, file?: { value?: unknown }) => visit(tree, typeof file?.value === "string" ? file.value : undefined);
}
