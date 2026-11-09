// suyuan fork: a bot's row in the list says it is working only for its own conversations, not for its turn in a room.
import { describe, expect, it } from "vitest";
import type { Bot, Message, Task } from "@/state/store";
import { t } from "@/lib/i18n";
import { sidebarBotStatus } from "./SidebarBotActivity";
import { botPreview } from "./sidebar-preview";

const task = (threadId: string, extra: Partial<Task> = {}): Task => ({ threadId, title: threadId, createdAt: 0, ...extra }) as Task;
const bot = (tasks: Task[] | undefined, extra: Partial<Bot> = {}): Bot =>
  ({ id: "outfit", name: "Outfit", threadId: "chat", tasks, ...extra }) as unknown as Bot;

describe("sidebarBotStatus", () => {
  it("is not working while only a room turn keeps the bot busy", () => {
    expect(sidebarBotStatus(bot([task("chat")], { busy: true, activity: "working" }), {}).working).toBe(false);
  });

  it("is working for its own chat or one of its routine runs", () => {
    expect(sidebarBotStatus(bot([task("chat", { busy: true, activity: "working" })], { busy: true }), {}).working).toBe(true);
    expect(sidebarBotStatus(bot([task("chat"), task("run", { busy: true, routineRunId: "r1" })], { busy: true }), {}).working).toBe(true);
  });

  it("still trusts the bot's flag when it lists no conversations", () => {
    expect(sidebarBotStatus(bot(undefined, { busy: true }), {}).working).toBe(true);
    expect(sidebarBotStatus(bot([], { busy: true }), {}).working).toBe(true);
  });

  it("still shows a room's question waiting on the person", () => {
    expect(sidebarBotStatus(bot([task("chat")], { busy: true, activity: "waiting-on-you" }), {}).waiting).toBe(true);
  });
});

describe("botPreview", () => {
  const said: Message[] = [{ id: "m", role: "bot", kind: "text", text: "Low boots suit you.", at: 1 }];

  it("keeps the last line while only a room turn keeps the bot busy, and says working for its own chat", () => {
    expect(botPreview(bot([task("chat")], { busy: true, messages: said }), said, [], false)).toBe("Low boots suit you.");
    expect(botPreview(bot([task("chat", { busy: true })], { busy: true, messages: said }), said, [], false)).toBe(t("sidebar.preview.working"));
  });
});
