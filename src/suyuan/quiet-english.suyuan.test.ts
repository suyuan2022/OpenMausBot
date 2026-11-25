import { afterEach, describe, expect, it } from "vitest";

import { noteThreadsShown } from "./home";
import { allEnglish, quietChat, withoutEnglishSteps } from "./quiet-english";

const person = (id: string, text: string) => ({ id, role: "user", kind: "text", text });
const bot = (id: string, text: string) => ({ id, role: "bot", kind: "text", text });
const step = (id: string) => ({ id, role: "bot", kind: "activity" });
const inTurn = (id: string, text: string, turnId: string, turnTerminal = false) => ({ ...bot(id, text), turnId, turnTerminal });
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
    expect(allEnglish("See [the notes](./notes.md).")).toBe(false);
    expect(allEnglish("| a | b |")).toBe(false);
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

  it("without a turn, shows the newest line until its bot says something later", () => {
    const running = [person("p", "查一下"), bot("a", "先看日志。"), bot("b", "Reading the log now.")];
    expect(ids(withoutEnglishSteps(running))).toEqual(["p", "a", "b"]);
    expect(ids(withoutEnglishSteps([...running, bot("c", "日志看完了。")]))).toEqual(["p", "a", "c"]);
  });

  it("keeps a running turn's English lines out from the start, and shows its answer once the turn ends", () => {
    const running = [person("p", "查一下"), inTurn("a", "Reading the log now.", "t1")];
    expect(ids(withoutEnglishSteps(running))).toEqual(["p"]);
    const ended = [person("p", "查一下"), inTurn("a", "Reading the log now.", "t1"), inTurn("b", "All clear.", "t1", true)];
    expect(ids(withoutEnglishSteps(ended))).toEqual(["p", "b"]);
  });

  it("keeps each turn's answer, also when no one speaks between two turns (a scheduled run's report)", () => {
    const runs = [inTurn("a", "Daily check: all good.", "t1", true), inTurn("b", "Checking again.", "t2"), inTurn("c", "今天也正常。", "t2", true)];
    expect(ids(withoutEnglishSteps(runs))).toEqual(["a", "c"]);
  });

  it("keeps a line with attachments, the pinned message, and a link, table or math", () => {
    const turn = [
      person("p", "发我"),
      { ...bot("a", "Report attached."), attachments: [{ name: "report.pdf" }] },
      bot("b", "Pinned note."),
      bot("c", "See [the notes](./notes.md)."),
      bot("d", "| name | value |\n|---|---|\n| a | 1 |"),
      bot("e", "$$x^2$$"),
      bot("f", "Checking."),
      bot("g", "发你了。"),
    ];
    expect(ids(withoutEnglishSteps(turn, "b"))).toEqual(["p", "a", "b", "c", "d", "e", "g"]);
  });

  it("in a room, a bot's line goes only for that bot's later line", () => {
    const room = [person("p", "大家看看"), { ...bot("a", "On it."), from: { botId: "x" } }, { ...bot("b", "我看完了。"), from: { botId: "y" } }];
    expect(ids(withoutEnglishSteps(room))).toEqual(["p", "a", "b"]);
    expect(ids(withoutEnglishSteps([...room, { ...bot("c", "好了。"), from: { botId: "x" } }]))).toEqual(["p", "b", "c"]);
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
