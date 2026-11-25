import { afterEach, describe, expect, it } from "vitest";

import { noteThreadsShown } from "./home";
import { allEnglish, quietChat, withoutEnglishSteps } from "./quiet-english";

const person = (id: string, text: string) => ({ id, role: "user", kind: "text", text });
const bot = (id: string, text: string) => ({ id, role: "bot", kind: "text", text });
const step = (id: string) => ({ id, role: "bot", kind: "activity" });
const ids = (messages: Array<{ id: string }>) => messages.map((message) => message.id);

describe("allEnglish", () => {
  it("is a line with Latin letters and no Chinese", () => {
    expect(allEnglish("Checking the file now.")).toBe(true);
    expect(allEnglish("Typecheck and lint pass; launching the fixture on 18910.")).toBe(true);
  });

  it("is not a line with any Chinese, one with no letters, a link or a code block", () => {
    expect(allEnglish("看一下 README 和 FORK.md")).toBe(false);
    expect(allEnglish("好的，`pnpm lint` 过了。")).toBe(false);
    expect(allEnglish("12:30 → 13:00")).toBe(false);
    expect(allEnglish("")).toBe(false);
    expect(allEnglish("https://bot.tokenic.cn/report")).toBe(false);
    expect(allEnglish("```\npnpm build\n```")).toBe(false);
  });
});

describe("withoutEnglishSteps", () => {
  it("leaves out an English line along the way, keeps the turn's last line", () => {
    const turn = [person("p", "改一下"), bot("a", "Checking the file now."), step("s"), bot("b", "改好了。")];
    expect(ids(withoutEnglishSteps(turn))).toEqual(["p", "s", "b"]);
  });

  it("keeps a turn's last line in English, and an earlier turn's", () => {
    const turns = [person("p1", "hi"), bot("a", "Done."), person("p2", "再看看"), bot("b", "Looking."), bot("c", "看完了")];
    expect(ids(withoutEnglishSteps(turns))).toEqual(["p1", "a", "p2", "c"]);
  });

  it("shows the newest line of a running turn until a later line comes", () => {
    const running = [person("p", "查一下"), bot("a", "先看日志。"), bot("b", "Reading the log now.")];
    expect(ids(withoutEnglishSteps(running))).toEqual(["p", "a", "b"]);
    expect(ids(withoutEnglishSteps([...running, bot("c", "日志看完了。")]))).toEqual(["p", "a", "c"]);
  });

  it("gives back the same array when nothing is left out", () => {
    const turn = [person("p", "hi"), bot("a", "你好")];
    expect(withoutEnglishSteps(turn)).toBe(turn);
  });
});

describe("quietChat", () => {
  const turn = [person("p", "改一下"), bot("a", "Checking the file now."), bot("b", "改好了。")];
  afterEach(() => noteThreadsShown(true));

  it("leaves English lines along the way out once the app hides the thread list", () => {
    noteThreadsShown(false);
    expect(ids(quietChat(turn))).toEqual(["p", "b"]);
  });

  it("is upstream's chat while the thread list shows", () => {
    expect(quietChat(turn)).toBe(turn);
  });
});
