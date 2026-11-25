// suyuan fork: bold that Markdown's own rule leaves as stars in Chinese. A closing "**" right after a punctuation mark and
// right before a character ("**晚上照常：**21:00"), or an opening one between a character and a punctuation mark
// ("这是**「重点」**吗"), does not count as a delimiter, so the reply showed the stars. After parsing, the "**" left in a
// paragraph's text pair up in the order they come, also across a link or inline code ("这是**「[参考](./ref)」**吗"), and
// a pair whose words hold a Chinese character, neither starting nor ending with a space, becomes bold. A star written
// escaped ("\*") stays a star, and code, inline code and math are never touched.
type Node = { type: string; value?: string; children?: Node[]; position?: { start: { offset?: number }; end: { offset?: number } } };
type Star = { node: number; at: number };

const CHINESE = /[㐀-鿿豈-﫿　-〿＀-￯]/;
const SKIPPED = new Set(["code", "inlineCode", "math", "inlineMath", "html"]);
const CLOSING = /[」』）】〉》〕〗”’）］｝]$/;
const OPENING = /^[「『（【〈《〔〖“‘（［｛]/;
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;

const textOf = (node: Node): string => node.value ?? node.children?.map(textOf).join("") ?? "";
const sourceOf = (node: Node, source: string | undefined) => {
  const start = node.position?.start.offset, end = node.position?.end.offset;
  return source === undefined || start === undefined || end === undefined ? undefined : source.slice(start, end);
};

/** The offsets in a text node's value of stars written escaped; null when its source does not line up with its value
 * (an entity, a line ending), and the node keeps its stars as written. */
function escapedStars(node: Node, source: string | undefined): Set<number> | null {
  const raw = sourceOf(node, source), value = node.value!;
  if (raw === undefined) return new Set();
  if (!raw.includes("\\*")) return new Set();
  const out = new Set<number>();
  let at = 0;
  for (let index = 0; index < raw.length && at < value.length; index++) {
    if (raw[index] === "\\" && raw[index + 1] === value[at] && ASCII_PUNCTUATION.test(value[at]!)) {
      if (value[at] === "*") out.add(at);
      at++;
      index++;
    } else if (raw[index] === value[at]) at++;
    else return null;
  }
  return out;
}

/** What lies between two stars, or null when a line break does. */
function between(children: Node[], open: Star, close: Star): string | null {
  const value = (index: number) => children[index]!.value!;
  if (open.node === close.node) return value(open.node).slice(open.at + 2, close.at);
  const middle = children.slice(open.node + 1, close.node);
  if (middle.some((node) => node.type === "break")) return null;
  return value(open.node).slice(open.at + 2) + middle.map(textOf).join("") + value(close.node).slice(0, close.at);
}

/** `children` with each bold pair of left-over stars made a strong node; the same array when there is none. */
function pairStars(children: Node[], escaped: Map<Node, Set<number> | null>): Node[] {
  const stars: Star[] = [];
  children.forEach((node, index) => {
    if (node.type !== "text") return;
    const skip = escaped.get(node);
    if (skip === null) return;
    for (let at = node.value!.indexOf("**"); at >= 0; at = node.value!.indexOf("**", at + 2)) {
      if (!skip?.has(at) && !skip?.has(at + 1)) stars.push({ node: index, at });
    }
  });
  const marked = new Map<number, { at: number; opens: boolean }[]>();
  for (let index = 0; index + 1 < stars.length; index++) {
    const open = stars[index]!, close = stars[index + 1]!;
    const inner = between(children, open, close);
    if (inner === null || !CHINESE.test(inner) || /^[\s*]|[\s*]$|\n/.test(inner)) continue;
    for (const [star, opens] of [[open, true], [close, false]] as const) {
      const list = marked.get(star.node) ?? [];
      list.push({ at: star.at, opens });
      marked.set(star.node, list);
    }
    index++;
  }
  if (!marked.size) return children;
  const out: Node[] = [];
  let strong: Node[] | null = null;
  const put = (node: Node) => (strong ?? out).push(node);
  children.forEach((node, index) => {
    const marks = marked.get(index);
    if (!marks) return put(node);
    let from = 0;
    for (const mark of marks) {
      if (mark.at > from) put({ type: "text", value: node.value!.slice(from, mark.at) });
      if (mark.opens) strong = [];
      else {
        out.push({ type: "strong", children: strong! });
        strong = null;
      }
      from = mark.at + 2;
    }
    if (from < node.value!.length) put({ type: "text", value: node.value!.slice(from) });
  });
  return out;
}

/** "**「设置」**和**「通知」**": Markdown pairs the stars around "和", between a closing and an opening bracket, and leaves
 * the outer two as text. A "**" bold like that, with left-over stars before and after it, goes back to its stars, so all
 * four pair up as written. One written with "__" is what it says. */
function unpaired(children: Node[], escaped: Map<Node, Set<number> | null>, source: string | undefined): Node[] {
  const stars = (node: Node) => node.type === "text" && escaped.get(node) !== null && node.value!.includes("**");
  const out: Node[] = [];
  children.forEach((node, index) => {
    const before = children[index - 1], after = children[index + 1];
    const misread = node.type === "strong" && before !== undefined && after !== undefined
      && sourceOf(node, source)?.startsWith("**") === true && CLOSING.test(textOf(before)) && OPENING.test(textOf(after))
      && children.slice(0, index).some(stars) && children.slice(index + 1).some(stars);
    if (misread) out.push({ type: "text", value: "**" }, ...node.children!, { type: "text", value: "**" });
    else out.push(node);
  });
  return out;
}

function visit(node: Node, source: string | undefined): void {
  if (!node.children) return;
  const escaped = new Map<Node, Set<number> | null>();
  for (const child of node.children) {
    if (child.type === "text") {
      if (child.value?.includes("**")) escaped.set(child, escapedStars(child, source));
    } else if (!SKIPPED.has(child.type)) visit(child, source);
  }
  node.children = pairStars(unpaired(node.children, escaped, source), escaped);
}

export function remarkCjkStrong() {
  return (tree: Node, file?: { value?: unknown }) => visit(tree, typeof file?.value === "string" ? file.value : undefined);
}
