// @vitest-environment happy-dom
// suyuan fork: a conversation opens at its newest message, and a tapped notification's fresh page opens on that bot.
import { afterEach, describe, expect, it } from "vitest";
import { LAST_CONVERSATION_KEY } from "@/lib/last-conversation";
import { forgetTranscriptPositions, readTranscriptPosition, rememberTranscriptPosition } from "@/lib/transcript-follow";
import { forgetShownChat, openAtLatest, shownChat } from "./open-at-latest";
import { pushTarget, resumeOnPushTarget } from "./push-resume";

afterEach(() => {
  forgetShownChat();
  forgetTranscriptPositions();
  localStorage.clear();
});

describe("a conversation opens at its newest message", () => {
  const state = (selectedId: string, activeView = "chat") => ({
    activeView,
    selectedId,
    bots: [{ id: "lizhi", threadId: "home" }, { id: "ns", threadId: "ns-home" }],
    groups: [{ id: "room", threadId: "room-thread" }],
  }) as unknown as Parameters<typeof shownChat>[0];

  it("names the chat the shell shows: the selected room or bot, the first bot, nothing off the chat", () => {
    expect(shownChat(state("room"))).toEqual({ ownerId: "room", threadId: "room-thread" });
    expect(shownChat(state("ns"))).toEqual({ ownerId: "ns", threadId: "ns-home" });
    expect(shownChat(state("gone"))).toEqual({ ownerId: "lizhi", threadId: "home" });
    expect(shownChat(state("ns", "routines"))).toBeNull();
  });

  it("forgets where the reader left a conversation when it is opened again, and keeps the place within one visit", () => {
    openAtLatest({ ownerId: "ns", threadId: "ns-home" });
    rememberTranscriptPosition("ns:ns-home", { atEnd: false, rowId: "older", offsetWithinRow: 12 });
    openAtLatest({ ownerId: "ns", threadId: "ns-home" });
    expect(readTranscriptPosition("ns:ns-home")).toMatchObject({ atEnd: false, rowId: "older" });

    openAtLatest({ ownerId: "lizhi", threadId: "home" });
    openAtLatest({ ownerId: "ns", threadId: "ns-home" });
    expect(readTranscriptPosition("ns:ns-home")).toEqual({ atEnd: true });
  });

  it("opens at the newest message after a page that is not a chat", () => {
    openAtLatest({ ownerId: "ns", threadId: "ns-home" });
    rememberTranscriptPosition("ns:ns-home", { atEnd: false, rowId: "older" });
    openAtLatest(null);
    openAtLatest({ ownerId: "ns", threadId: "ns-home" });
    expect(readTranscriptPosition("ns:ns-home")).toEqual({ atEnd: true });
  });
});

describe("a notification's fresh page", () => {
  it("reads the notification's bot and thread from the address", () => {
    expect(pushTarget("?pushBot=b1&pushThread=t1")).toEqual({ botId: "b1", threadId: "t1" });
    expect(pushTarget("?pushBot=b1")).toBeNull();
    expect(pushTarget("")).toBeNull();
  });

  it("takes the notification's bot as the conversation the app reopens on", () => {
    localStorage.setItem(LAST_CONVERSATION_KEY, "lizhi");
    resumeOnPushTarget("?pushBot=ns&pushThread=ns-home");
    expect(localStorage.getItem(LAST_CONVERSATION_KEY)).toBe("ns");
    resumeOnPushTarget("");
    expect(localStorage.getItem(LAST_CONVERSATION_KEY)).toBe("ns");
  });
});
