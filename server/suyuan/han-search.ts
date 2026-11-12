// suyuan fork: Chinese words in session_search and auto-recall. messages_fts and memory_fts split text with unicode61, which
// keeps a whole run of Han characters between two spaces or punctuation marks as one token, so "模型" never matched
// "的默认模型切换为". A query holding a Han character is answered here instead, by containment over the same rows, and is
// ranked like FTS5's bm25; a query without one still goes to FTS in server/message-db.ts, untouched.
import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import { recallMatchTerm, recallTerms as upstreamTerms, type MemoryHit, type RecallHit, type RecallRange, type SearchMode } from "../message-db.ts";
import { peerProvenanceAuthor } from "../peer-provenance.ts";

const HAN = /\p{Script=Han}/u;
export const hasHan = (text: string): boolean => HAN.test(text);

// ---- Terms -------------------------------------------------------------------------------------------------------------

/** Chinese words that name no topic: pronouns, function words, filler, the Chinese side of message-db's STOP_WORDS and RECALL_FILLER. */
const ZH_STOP = new Set(
  ("这个 那个 一个 哪个 什么 一下 可以 自己 看看 我们 你们 他们 它们 咱们 怎么 怎样 怎么样 没有 就是 需要 还是 不是 为什么 现在 但是 如果 时候 " +
    "我的 你的 他的 它的 这么 那么 还有 所以 如何 之前 或者 是不是 应该 感觉 知道 比较 直接 不能 可能 觉得 能不能 可不可以 因为 这样 那样 别的 " +
    "不用 那就 而是 的话 不知道 东西 事情 这边 那边 比如 这里 那里 出来 这些 那些 所有 已经 之后 以后 不需要 一些 不要 希望 都是 一次 其实 也许 " +
    "也可以 之类 尽量 其他 一起 里面 本身 那种 这种 也没有 关于 必须 以及 起来 哪里 最好 类似 想要 看一下 记得 告诉 帮我 谢谢 好的 是的 对的 " +
    "然后 有没有 要不 要不要 一直 还要 只是 只有 而且 不过 虽然 并且 另外 我想 你看 你好 请问 麻烦 一点 有点 有些 很多 非常 特别 真的 确实 当然 " +
    "大概 好像 一样 上次 刚才 刚刚 我要 我在 我还 说的 做的 的是 不对 不行 就行 行吗 好了 好吧 可以吗 对吧 是吗 以为 嗯嗯 噢噢 哈哈 " +
    "问题 意思 情况 原因 办法 方式 地方 部分 整个 另一 过去 继续 开始 进行 使用 出现 看到 提到 了解 发现 处理 提醒 问问 到了 会不会 " +
    "今天 明天 昨天 早上 晚上 上午 下午 中午 等会 一会儿 待会 那天 这天 当时 那时 那件 这件 那条 这条 那次 这次 " +
    "今晚 明早 昨晚 前天 后天 每天 周末 几点 下个月 上个月 周一 周二 周三 周四 周五 周六 周日 今天早上 今天晚上 明天早上 明天晚上 " +
    "昨天早上 昨天晚上 顺便 我去 我看 是有 给我一个 弄好 具体 主要 不少 回去 正常 前面 后面 最后 买的 用的 写的 发的 找的 看的 弄的 改的").split(" "),
);
/** A two-character word ending in 了 or 吗 says no more than its first character: 改了, 洗了, 行吗. */
const PARTICLE_END = /^\p{Script=Han}[了吗]$/u;

/** One-character segments that join nothing: "磁/吸" makes 磁吸 and "手机/壳" makes 手机壳, "你/看" and "的/事" make nothing. */
const ZH_GLUE = new Set("的了吗呢吧啊呀哦嗯嘛么着过得地你我他她它们这那哪啥谁是有没不别在和与跟及或也都就才又再还很太更最已刚先把被给让叫对从向往为于以而但并如若会能要想去来说看用点弄做干帮试查找写发改聊个些一两几下上里中后前等好多少");

const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
const RECALL_TERMS = 16;
/** A clause this long also stands as one term, so a passage that repeats it word for word ranks first. */
const CLAUSE_CHARS = 4;
/** A number written against Chinese characters, one or two digits, would match every count and date: 3个, 11月. */
const SHORT_NUMBER = /^\d{1,2}$/;

interface HanTerms {
  terms: string[];
  /** The whole clauses among terms: they help find and rank, but are not words of their own. */
  clauses: ReadonlySet<string>;
}

function hanTerms(query: string): HanTerms {
  const words: string[] = [];
  const clauses: string[] = [];
  const keep = (term: string) => {
    if (!words.includes(term)) words.push(term);
  };
  const add = (term: string) => {
    if (term.length >= 2 && !ZH_STOP.has(term) && !PARTICLE_END.test(term)) keep(term);
  };
  for (const token of upstreamTerms(query)) {
    if (!hasHan(token)) {
      keep(token);
      continue;
    }
    if (token.length >= CLAUSE_CHARS) clauses.push(token);
    let word = "";
    let run = "";
    const flush = () => {
      if (run.length >= 2) add(run);
      for (let i = 0; run.length >= 3 && i + 1 < run.length; i++) add(run.slice(i, i + 2));
      if (word && hasHan(run.charAt(0))) add(word + run.charAt(0));
      run = "";
    };
    // The parts between Han characters stay whole, as upstream keeps them: "11/12" is one term, which recallMatchTerm skips.
    for (const part of token.split(/(\p{Script=Han}+)/u)) {
      if (!part) continue;
      if (!hasHan(part)) {
        // One letter joins the characters after it: T恤, B站, U盘.
        if (/^\p{L}$/u.test(part)) {
          run += part;
          continue;
        }
        flush();
        word = "";
        for (const term of upstreamTerms(part)) if (!SHORT_NUMBER.test(term)) keep(term);
        continue;
      }
      for (const { segment } of segmenter.segment(part)) {
        if (segment.length > 1) {
          flush();
          word = ZH_STOP.has(segment) ? "" : segment;
          add(segment);
        } else if (ZH_GLUE.has(segment)) {
          flush();
          word = "";
        } else {
          run += segment;
        }
      }
    }
    flush();
  }
  return { terms: [...words, ...clauses.filter((clause) => !words.includes(clause))].slice(0, RECALL_TERMS), clauses: new Set(clauses) };
}

/** message-db's recallTerms with every run of Han characters cut into words; a query without Han gets upstream's list as is. */
export function recallTerms(query: string): string[] {
  return hasHan(query) ? hanTerms(query).terms : upstreamTerms(query);
}

// ---- Matching ----------------------------------------------------------------------------------------------------------

interface Matcher {
  term: string;
  /** A superset of the rows that match, for SQL to narrow on. */
  like: string;
  /** The real test, also used to count and bracket each occurrence. */
  pattern: RegExp;
}

/** A letter or digit that is not Han: an English word or a number ends where one of these stops, even against a Han character. */
const WORD = String.raw`[[\p{L}\p{N}]--\p{Script=Han}]`;
const escapeRegExp = (text: string) => text.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
const escapeLike = (text: string) => text.replace(/[\\%_]/g, "\\$&");

function matcher(term: string, prefix: boolean, stem = term): Matcher {
  const body = escapeRegExp(stem);
  const source = hasHan(stem) ? body : `(?<!${WORD})${body}${prefix ? `${WORD}*` : `(?!${WORD})`}`;
  return { term, like: `%${escapeLike(stem)}%`, pattern: new RegExp(source, "giv") };
}

/** session_search: every space-separated word must be in the message; Han ones anywhere, the others as a whole word. */
function allMatchers(query: string): Matcher[] {
  const seen = new Set<string>();
  const out: Matcher[] = [];
  for (const raw of query.split(/\s+/)) {
    const token = raw.replace(/"/g, "").trim();
    if (!token || seen.has(token.toLowerCase())) continue;
    if (!hasHan(token) && !upstreamTerms(token).length) continue;
    seen.add(token.toLowerCase());
    out.push(matcher(token, false));
  }
  return out;
}

/** Auto-recall's test for one term: Han ones anywhere; the others keep recallMatchTerm's whole-word, prefix and skip rules. */
function recallMatcher(term: string): Matcher | null {
  if (hasHan(term)) return matcher(term, false);
  const fts = recallMatchTerm(term);
  if (!fts) return null;
  return fts.endsWith("*") ? matcher(term, true, fts.slice(1, -2)) : matcher(term, false);
}

/** Auto-recall: any term may match. */
function anyMatchers(query: string): Matcher[] {
  return recallTerms(query).flatMap((term) => recallMatcher(term) ?? []);
}

interface Found {
  start: number;
  end: number;
  term: number;
}

function occurrences(text: string, matchers: readonly Matcher[]): Found[] {
  const found: Found[] = [];
  matchers.forEach((m, term) => {
    for (const hit of text.matchAll(m.pattern)) found.push({ start: hit.index, end: hit.index + hit[0].length, term });
  });
  return found.sort((a, b) => a.start - b.start || b.end - a.end);
}

// ---- Snippets ----------------------------------------------------------------------------------------------------------

/** About what FTS5's 48-token snippet shows of Chinese text. */
const SNIPPET_CHARS = 160;

/** The window holding the most different terms, matches in [brackets] like FTS5's snippet(), whitespace folded. */
function snippet(text: string, found: readonly Found[]): string {
  let best = { from: 0, to: 0, terms: 0 };
  for (let i = 0; i < found.length; i++) {
    const terms = new Set<number>();
    let j = i;
    while (j < found.length && found[j]!.end - found[i]!.start <= SNIPPET_CHARS) terms.add(found[j++]!.term);
    if (terms.size > best.terms) best = { from: found[i]!.start, to: found[j - 1]!.end, terms: terms.size };
  }
  const spare = SNIPPET_CHARS - (best.to - best.from);
  let start = Math.max(0, best.from - Math.floor(spare / 3));
  const end = Math.min(text.length, start + SNIPPET_CHARS);
  start = Math.max(0, Math.min(start, end - SNIPPET_CHARS));
  let out = start > 0 ? "…" : "";
  let at = start;
  for (const hit of found) {
    if (hit.start < at || hit.end > end) continue;
    out += `${text.slice(at, hit.start)}[${text.slice(hit.start, hit.end)}]`;
    at = hit.end;
  }
  out += text.slice(at, end) + (end < text.length ? "…" : "");
  return out.replace(/\s+/g, " ").trim();
}

/**
 * recall.ts's enoughMatches for a query with Han characters: once the query has `min` words, a passage must hold two of them.
 * The passage's words are found in its text, not counted by its brackets, which the original text may have too. A word and
 * the longer pieces made from it (手机, 手机壳) count once, and whole clauses not at all, so one thing named is one word.
 */
export function hanEnoughMatches(query: string, passage: string, min: number): boolean {
  const { terms, clauses } = hanTerms(query);
  const words = terms.filter((term) => !clauses.has(term));
  const parent = words.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)));
  words.forEach((a, i) => words.forEach((b, j) => {
    if (j > i && hasHan(a) && hasHan(b) && (a.includes(b) || b.includes(a))) parent[root(j)] = root(i);
  }));
  if (new Set(words.map((_, i) => root(i))).size < min) return true;
  const held = new Set<number>();
  words.forEach((word, i) => {
    const test = recallMatcher(word);
    if (test && passage.search(test.pattern) >= 0) held.add(root(i));
  });
  return held.size >= 2;
}

// ---- Ranking -----------------------------------------------------------------------------------------------------------

interface Candidate {
  text: string;
  found: Found[];
}

/** FTS5's bm25 (k1 1.2, b 0.75) over the rows found, counting characters for length; rows matching no term score -1. */
function scores(rows: readonly Candidate[], terms: number, total: number, mode: SearchMode): number[] {
  const df = Array.from({ length: terms }, () => 0);
  const counts = rows.map((row) => {
    const tf = Array.from({ length: terms }, () => 0);
    for (const hit of row.found) tf[hit.term]! += 1;
    tf.forEach((n, term) => {
      if (n) df[term]! += 1;
    });
    return tf;
  });
  const avg = rows.reduce((sum, row) => sum + row.text.length, 0) / Math.max(1, rows.length);
  const idf = df.map((n) => Math.log(1 + (Math.max(total, rows.length) - n + 0.5) / (n + 0.5)));
  return counts.map((tf, i) => {
    if (mode === "all" ? tf.some((n) => !n) : !tf.some(Boolean)) return -1;
    const norm = 1.2 * (0.25 + (0.75 * rows[i]!.text.length) / (avg || 1));
    return tf.reduce((sum, n, term) => sum + (idf[term]! * n * 2.2) / (n + norm), 0);
  });
}

const likeClause = (column: string, matchers: readonly Matcher[], mode: SearchMode) =>
  `(${matchers.map(() => `${column} LIKE ? ESCAPE '\\'`).join(mode === "all" ? " AND " : " OR ")})`;

// ---- Conversations -----------------------------------------------------------------------------------------------------

/**
 * The line a scheduled or manual run is handed, the same every run: composeExecutionPrompt (server/routine-execution.ts)
 * opens it with `[Scheduled routine "…"` or `[Routine "…"`, the headers routinePrompt there recognises.
 */
const RUN_INSTRUCTION = (alias: string) => `(${alias}.role = 'user' AND (${alias}.text LIKE '[Scheduled routine "%' OR ${alias}.text LIKE '[Routine "%'))`;
/** A webhook's run opens with webhookRunNote or webhookNote (server/webhooks.ts) and carries that event's data, so it stays a hit. */
const RUN_OPENING = (alias: string) => `coalesce(${alias}.text LIKE '[Scheduled routine "%' OR ${alias}.text LIKE '[Routine "%' OR ${alias}.text LIKE '[From webhook "%', 0)`;

/**
 * Conversations a routine run opened and the person has not written in: every line there from his side is what a run was
 * handed. Upstream keeps the same set as the routineRunId of the bot's records (store.ts, cleared once he writes), which is
 * not known down here.
 */
const RUNS =
  "runs(id) AS (SELECT f.thread_id FROM messages f WHERE f.thread_id IN (SELECT id FROM scope) AND f.role = 'user' AND f.kind = 'text' " +
  `AND json_extract(f.json, '$.peerAsk') IS NULL GROUP BY f.thread_id HAVING min(${RUN_OPENING("f")}) = 1)`;

const PEER_NOTE_HEAD_CHARS = 160;

/** recallMessages for a query with Han characters: the same rows and hit shape. Runs rank after the rest, digests last of all, and a run's instruction is never a hit. */
export function hanRecallMessages(db: DatabaseSync, query: string, threadIds: readonly string[], limit: number, range: RecallRange | undefined, mode: SearchMode): RecallHit[] {
  const matchers = mode === "all" ? allMatchers(query) : anyMatchers(query);
  if (!matchers.length || !threadIds.length) return [];
  const scope = JSON.stringify(threadIds);
  const window: SQLInputValue[] = [];
  let within = "";
  if (range?.since !== undefined) {
    within += " AND m.at >= ?";
    window.push(range.since);
  }
  if (range?.until !== undefined) {
    within += " AND m.at <= ?";
    window.push(range.until);
  }
  const rows = db
    .prepare(
      `WITH scope(id) AS (SELECT value FROM json_each(?)), ${RUNS} ` +
        "SELECT m.thread_id, m.id, m.at, m.role, m.kind, m.text, json_extract(m.json, '$.from.name') AS from_name, " +
        "json_extract(m.json, '$.peerAsk.name') AS peer_name, m.thread_id IN (SELECT id FROM runs) AS run FROM messages m " +
        `WHERE m.kind IN ('text', 'digest') AND m.text IS NOT NULL AND m.thread_id IN (SELECT id FROM scope)${within} ` +
        `AND NOT ${RUN_INSTRUCTION("m")} AND ${likeClause("m.text", matchers, mode)}`,
    )
    .all(scope, ...window, ...matchers.map((m) => m.like)) as Array<{
    thread_id: string;
    id: string;
    at: number;
    role: string;
    kind: string;
    text: string;
    from_name: string | null;
    peer_name: string | null;
    run: number;
  }>;
  const total =
    mode === "any"
      ? (db.prepare("SELECT count(*) AS n FROM messages WHERE kind IN ('text', 'digest') AND thread_id IN (SELECT value FROM json_each(?))").get(scope) as { n: number }).n
      : rows.length;
  const found = rows.map((row) => occurrences(row.text, matchers));
  const score = scores(rows.map((row, i) => ({ text: row.text, found: found[i]! })), matchers.length, total, mode);
  return rows
    .map((row, i) => ({ row, found: found[i]!, score: score[i]! }))
    .filter((hit) => hit.score >= 0)
    .sort((a, b) => Number(a.row.kind === "digest") - Number(b.row.kind === "digest") || a.row.run - b.row.run || b.score - a.score || b.row.at - a.row.at)
    .reduce<RecallHit[]>((hits, { row, found }) => {
      if (hits.length >= limit) return hits;
      const text = snippet(row.text, found);
      // Auto-recall has four places: a passage shown once (a report copied home, a webhook's set-up text) does not take two.
      if (mode === "any" && hits.some((hit) => hit.snippet === text)) return hits;
      const peer = row.peer_name ?? peerProvenanceAuthor(row.text.slice(0, PEER_NOTE_HEAD_CHARS));
      hits.push({
        threadId: row.thread_id,
        messageId: row.id,
        at: row.at,
        role: row.role,
        ...(row.kind === "digest" ? { kind: "digest" as const } : {}),
        snippet: text,
        ...(row.from_name ? { from: row.from_name } : {}),
        ...(peer ? { peer } : {}),
      });
      return hits;
    }, []);
}

// ---- Memory files ------------------------------------------------------------------------------------------------------

/** recallMemory for a query with Han characters: the same files, and auto-recall skips the same ones. */
export function hanRecallMemory(db: DatabaseSync, query: string, botId: string, limit: number, mode: SearchMode): MemoryHit[] {
  const matchers = mode === "all" ? allMatchers(query) : anyMatchers(query);
  if (!matchers.length) return [];
  const recalled = mode === "any" ? " AND path NOT IN ('MEMORY.md', 'memory/archive.md') AND path NOT LIKE 'memory/log/%'" : "";
  const rows = db
    .prepare(`SELECT path, mtime_ms, text FROM memory_files WHERE bot_id = ?${recalled} AND ${likeClause("text", matchers, mode)}`)
    .all(botId, ...matchers.map((m) => m.like)) as Array<{ path: string; mtime_ms: number; text: string }>;
  const total = mode === "any" ? (db.prepare(`SELECT count(*) AS n FROM memory_files WHERE bot_id = ?${recalled}`).get(botId) as { n: number }).n : rows.length;
  const found = rows.map((row) => occurrences(row.text, matchers));
  const score = scores(rows.map((row, i) => ({ text: row.text, found: found[i]! })), matchers.length, total, mode);
  return rows
    .map((row, i) => ({ row, found: found[i]!, score: score[i]! }))
    .filter((hit) => hit.score >= 0)
    .sort((a, b) => b.score - a.score || b.row.mtime_ms - a.row.mtime_ms)
    .slice(0, limit)
    .map(({ row, found }) => ({ file: row.path, at: row.mtime_ms, snippet: snippet(row.text, found) }));
}
