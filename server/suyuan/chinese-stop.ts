// suyuan fork: a typed stop in Chinese. Upstream's stop words (room-holds.ts) hold only 「停止」 for Chinese, and a
// Chinese line has no spaces, so 「停」「别干了」「全部停下」 were read as an ordinary message. The whole message must be
// one of these (bar punctuation, a mention of the bot, and a trailing 吧/啊/呀/哈/了), so a sentence that merely
// contains 停 is never a stop.
const STOPS = new Set([
  "停", "停停", "停停停", "停下", "停下来", "停掉", "停一下", "停止", "先停", "先停下", "先停一下",
  "都停", "都停下", "都停掉", "全停", "全部停", "全部停下", "全部停掉", "全都停下", "叫停", "打住",
  "别干", "别干了", "不要干了", "别做", "别做了", "不用做了", "别弄了", "不用弄了", "算了别做了",
]);
const PARTICLES = /[吧啊呀哈了]+$/u;

/** `words`: the message's words as isStopCommand splits them, already lowercased and without mentions. */
export function isChineseStopWords(words: readonly string[]): boolean {
  if (words.length === 0 || words.length > 3) return false;
  return words.every((word) => STOPS.has(word) || STOPS.has(word.replace(PARTICLES, "")));
}
