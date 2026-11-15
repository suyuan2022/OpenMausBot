import { describe, expect, it } from "vitest";

import { SELF_THREAD_REFUSAL } from "../host/self-threads.ts";
import { composeEnvelope, composeReport } from "../runtime/envelope.ts";
import type { Assignment, EnvelopeNames } from "../runtime/types.ts";
import {
  handedTurn, ownOtherThread, ownOtherThreadRow, ownThreadRow, reopenOwnThread, SELF_BRIEF_MAX, SELF_NEEDS_THREAD, SELF_NO_CONSULT,
  SELF_SAME_THREAD, selfBriefLine, selfBriefTooLong, selfNotOpened, selfReportLine, selfTargetRefusal, selfThreadOpenedText,
} from "./self-thread.ts";
import { withThreadFacts } from "./thread-facts.ts";

const home = { botId: "clive", threadId: "home" };

describe("the one exception to never handing work to an ancestor", () => {
  it("lets a conversation's own turn hand work to another conversation of the same bot", () => {
    expect(ownOtherThread({ ...home }, { botId: "clive", threadId: "side" })).toBe(true);
    expect(ownOtherThreadRow({ assignee: { botId: "clive", destination: { threadId: "home" } } }, { botId: "clive", threadId: "side" })).toBe(true);
  });

  it("refuses everything else that would make a loop", () => {
    // Its own conversation.
    expect(ownOtherThread({ ...home }, { botId: "clive", threadId: "home" })).toBe(false);
    // Work that was handed to it: a thread opened from a thread, or work that went through a teammate and came back.
    expect(ownOtherThread({ ...home, parentId: "root" }, { botId: "clive", threadId: "side" })).toBe(false);
    expect(ownOtherThreadRow({ parentId: "root", assignee: { botId: "clive", destination: { threadId: "home" } } }, { botId: "clive", threadId: "side" })).toBe(false);
    // Another bot, a room on either side, and no parent at all.
    expect(ownOtherThread({ ...home }, { botId: "mira", threadId: "side" })).toBe(false);
    expect(ownOtherThread({ ...home, groupId: "room" }, { botId: "clive", threadId: "side" })).toBe(false);
    expect(ownOtherThread({ ...home }, { botId: "clive", threadId: "side", groupId: "room" })).toBe(false);
    expect(ownOtherThread(undefined, { botId: "clive", threadId: "side" })).toBe(false);
    expect(ownOtherThreadRow(undefined, { botId: "clive", threadId: "side" })).toBe(false);
  });
});

describe("when coordinate_bots may go to the caller itself", () => {
  const mine = { openedBy: { botId: "clive" } };
  const ask = (over: Partial<Parameters<typeof selfTargetRefusal>[0]> = {}) => selfTargetRefusal({
    opening: false, answers: false, answeringBack: false, consult: false, thread: "side", botId: "clive", fromThreadId: "home",
    handoff: false, requestLine: {}, task: mine, ...over });

  it("allows a message into a thread the bot opened on itself", () => {
    expect(ask()).toBeUndefined();
  });

  it("allows start_thread's own opening, an answer to a question, and a notice back to the opener", () => {
    expect(ask({ opening: true, thread: "new", task: undefined })).toBeUndefined();
    expect(ask({ answers: true, task: undefined })).toBeUndefined();
    expect(ask({ answeringBack: true, handoff: true, task: undefined })).toBeUndefined();
  });

  it("refuses the rest, each in words that say what to do instead", () => {
    expect(ask({ consult: true })).toBe(SELF_NO_CONSULT);
    expect(ask({ thread: "standing" })).toBe(SELF_NEEDS_THREAD);
    expect(ask({ thread: "new" })).toBe(SELF_NEEDS_THREAD);
    expect(ask({ thread: "home" })).toBe(SELF_SAME_THREAD);
    expect(ask({ task: undefined })).toBe(selfNotOpened("side"));
    expect(ask({ task: {} }), "a thread the person opened").toBe(selfNotOpened("side"));
    expect(ask({ task: { openedBy: { botId: "mira" } } }), "a thread a teammate opened").toBe(selfNotOpened("side"));
    expect(ask({ task: { openedBy: { botId: "clive", roomLane: {} } } }), "a room's lane").toBe(selfNotOpened("side"));
  });

  it("refuses a hand-off turn and a thread the bot opened on itself, as start_thread does", () => {
    expect(ask({ handoff: true })).toBe(SELF_THREAD_REFUSAL);
    expect(ask({ requestLine: { peerAsk: {} } })).toBe(SELF_THREAD_REFUSAL);
    expect(ask({ handoff: true, thread: "new" })).toBe(SELF_THREAD_REFUSAL);
  });
});

describe("which turns count as a hand-off", () => {
  const nodes: Record<string, { parentId?: string; groupId?: string }> = { root: {}, child: { parentId: "root" }, room: { groupId: "g" } };
  const node = (id: string) => nodes[id];

  it("does not count a person's turn, or a conversation's own turn resumed with a result", () => {
    expect(handedTurn(undefined, node)).toBe(false);
    expect(handedTurn("root", node)).toBe(false);
  });

  it("counts handed work, a room turn, and a turn whose node is unknown", () => {
    expect(handedTurn("child", node)).toBe(true);
    expect(handedTurn("room", node)).toBe(true);
    expect(handedTurn("gone", node)).toBe(true);
  });
});

describe("a message into an archived thread", () => {
  const store = (task: { archivedAt?: number; openedBy?: { botId?: string; roomLane?: unknown } } | undefined) => {
    const patches: unknown[] = [];
    return { patches, taskByThread: () => task, patchTask: (_bot: string, _thread: string, patch: { archivedAt?: number | undefined }) => { patches.push(patch); if (task) Object.assign(task, patch); } };
  };

  it("brings back a thread its sender opened", () => {
    const task = { archivedAt: 5, openedBy: { botId: "clive" } };
    const s = store(task);
    expect(reopenOwnThread(s, "clive", "side", "clive")).toBe(true);
    expect(task.archivedAt).toBeUndefined();
    expect(reopenOwnThread(s, "clive", "side", "clive"), "nothing to do the second time").toBe(false);
    expect(s.patches).toHaveLength(1);
  });

  it("brings back a thread the sender opened on a teammate too", () => {
    expect(reopenOwnThread(store({ archivedAt: 5, openedBy: { botId: "clive" } }), "mira", "work", "clive")).toBe(true);
  });

  it("leaves alone a thread someone else opened, a room's lane, and the standing and new threads", () => {
    for (const task of [{ archivedAt: 5 }, { archivedAt: 5, openedBy: { botId: "mira" } }, { archivedAt: 5, openedBy: { botId: "clive", roomLane: {} } }, { openedBy: { botId: "clive" } }, undefined]) {
      const s = store(task);
      expect(reopenOwnThread(s, "clive", "side", "clive")).toBe(false);
      expect(s.patches).toEqual([]);
    }
    const s = store({ archivedAt: 5, openedBy: { botId: "clive" } });
    expect(reopenOwnThread(s, "clive", "standing", "clive")).toBe(false);
    expect(reopenOwnThread(s, "clive", "new", "clive")).toBe(false);
  });
});

describe("the row the opening conversation keeps", () => {
  const clive = { id: "clive", name: "Clive", color: "#111" };
  const line = (key: string, vars: Record<string, string>) => `${key} ${JSON.stringify(vars)}`;

  it("names the thread, not the bot, when a bot opens or writes to a thread of its own", () => {
    const opened = ownThreadRow({ sender: clive, recipient: clive, threadId: "side", title: "Count", opening: true, inRoom: false, line });
    expect(opened).toEqual({ role: "bot", kind: "activity", tool: { name: 'server.rooms.openedThread {"title":"Count"}', ok: true }, threadRef: { botId: "clive", threadId: "side", title: "Count" } });
    const sent = ownThreadRow({ sender: clive, recipient: clive, threadId: "side", title: "Count", opening: false, inRoom: true, line });
    expect(sent?.tool.name).toBe('server.teammates.sent {"bot":"#Count"}');
    expect(sent?.from).toEqual({ botId: "clive", name: "Clive", color: "#111" });
  });

  it("is upstream's row for a teammate", () => {
    expect(ownThreadRow({ sender: clive, recipient: { id: "mira", name: "Mira", color: "#222" }, threadId: "work", title: "T", opening: false, inRoom: false, line })).toBeUndefined();
  });
});

describe("what the two conversations read", () => {
  const own = { requester: { kind: "bot_turn", botId: "clive" }, assignee: { botId: "clive", destination: { threadId: "side" } } };
  const teammate = { requester: { kind: "bot_turn", botId: "clive" }, assignee: { botId: "mira", destination: { threadId: "work" } } };
  const quoted = (text: string | undefined) => text ?? "";

  it("tells the thread that the brief is its own words from another conversation, not the person's", () => {
    expect(selfBriefLine(own, { requester: "Clive", thread: "Launch" }, "Sam", quoted))
      .toBe('@Clive here is you: you opened this thread yourself, from your conversation "Launch". The brief below is your own words from there, not Sam\'s. ');
    expect(selfBriefLine(own, { requester: "Clive" }, "Sam", quoted)).toContain("from another conversation of yours.");
    expect(selfBriefLine(teammate, { requester: "Clive", thread: "Launch" }, "Sam", quoted)).toBe("");
    expect(selfBriefLine({ ...own, requester: { kind: "person" } }, { requester: "Sam" }, "Sam", quoted)).toBe("");
  });

  it("tells the opening conversation whose report it is and how to write to that thread again", () => {
    expect(selfReportLine(own)).toBe('This report comes from a thread you opened on yourself [thread id: side]. To send it another message, call coordinate_bots with bot_ids ["clive"] and thread "side".');
    expect(selfReportLine(teammate)).toBeUndefined();
    expect(selfReportLine({ ...own, assignee: { botId: "clive", destination: { threadId: "side", groupId: "room" } } })).toBeUndefined();
  });

  it("is in the envelope and the report the runtime composes, and nowhere in a teammate's", () => {
    const assignment = (assigneeBot: string): Assignment => ({
      id: "a1", rootId: "r1", parentId: "r1", depth: 1, mode: "work", reply: "resume", brief: "Count the files.", status: "completed", result: "12 files.", executions: 1,
      createdAt: 1, updatedAt: 1, origin: { kind: "person", personKey: "p" }, requester: { kind: "bot_turn", botId: "clive", threadId: "home", generation: "g" },
      assignee: { botId: assigneeBot, destination: { threadId: "side" } }, level: "full",
    } as unknown as Assignment);
    const names = { requester: "Clive", assignee: "Clive", person: "Sam", thread: "Launch", askTool: "ask_user" } as unknown as EnvelopeNames;
    const envelope = composeEnvelope(assignment("clive"), names);
    expect(envelope).toContain("[From @Clive (bot) · assignment a1");
    expect(envelope).toContain('@Clive here is you: you opened this thread yourself, from your conversation "Launch".');
    expect(composeReport(assignment("clive"), names)).toContain("This report comes from a thread you opened on yourself [thread id: side].");
    const others = { ...names, assignee: "Mira" } as EnvelopeNames;
    expect(composeEnvelope(assignment("mira"), others)).not.toContain("here is you");
    expect(composeReport(assignment("mira"), others)).not.toContain("a thread you opened on yourself");
  });

  it("answers start_thread with where the result goes and how to write to the thread again", () => {
    const text = selfThreadOpenedText({ opened: "Opened thread #Count on yourself [thread id: side].", title: "Count", threadId: "side", botId: "clive", assignmentId: "a1" });
    expect(text).toContain("its result returns to this conversation and resumes you (assignment id: a1)");
    expect(text).toContain('call coordinate_bots with bot_ids ["clive"] and thread "side"');
    expect(text).toContain("Mention it to the person as #Count and finish your turn");
  });

  it("says how long a brief may be, which is what the runtime keeps of one", () => {
    expect(SELF_BRIEF_MAX).toBe(12_000);
    expect(selfBriefTooLong(12_001)).toContain("12001 characters");
  });
});

describe("the tools bots are shown", () => {
  it("gives start_thread a report parameter and leaves its other parameters alone", () => {
    const upstream = { name: "start_thread", description: "x", inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } };
    const shown = withThreadFacts(upstream) as typeof upstream & { inputSchema: { properties: Record<string, any> } };
    expect(shown.inputSchema.properties.report.enum).toEqual(["resume", "none"]);
    expect(shown.inputSchema.properties.title).toEqual({ type: "string" });
    expect(shown.inputSchema.required).toEqual(["title"]);
    expect(upstream.inputSchema.properties).toEqual({ title: { type: "string" } });
  });
});
