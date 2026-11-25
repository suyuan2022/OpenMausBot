import { describe, expect, it } from "vitest";
import { chatAlone } from "./chat-alone";

const chat = {
  activeView: "chat" as const,
  settingsOpen: false,
  computerOpen: false,
  inspectorOpen: false,
  activityOpen: false,
  notificationsOpen: false,
};
const closed = { inboxOpen: false, roomOpen: false };

describe("chatAlone", () => {
  it("holds for the chat with every panel closed", () => {
    expect(chatAlone(chat, closed)).toBe(true);
  });

  it("fails for any other view, and for any panel the app reopens closed, the pinned notification tray among them", () => {
    expect(chatAlone({ ...chat, activeView: "team-map" }, closed)).toBe(false);
    for (const panel of ["settingsOpen", "computerOpen", "inspectorOpen", "activityOpen", "notificationsOpen"] as const) {
      expect(chatAlone({ ...chat, [panel]: true }, closed), panel).toBe(false);
    }
    expect(chatAlone(chat, { ...closed, inboxOpen: true })).toBe(false);
    expect(chatAlone(chat, { ...closed, roomOpen: true })).toBe(false);
  });
});
