// suyuan fork: the few lines in upstream files that plug the fork in. A daily merge of upstream that drops one of them
// would silently switch a feature off, since every other test only exercises the fork's own files; this one goes red.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const source = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** The text of `function name(` up to the next top-level function: enough to say a call sits inside it. */
function functionBody(text: string, name: string): string {
  const start = text.indexOf(`function ${name}(`);
  expect(start, `function ${name} is gone`).toBeGreaterThanOrEqual(0);
  const next = text.indexOf("\nfunction ", start + 1);
  return text.slice(start, next < 0 ? undefined : next);
}

describe("the fork's hooks into upstream files", () => {
  it("server/index.ts loads the fork and hands every broadcast frame to it", () => {
    const index = source("server/index.ts");
    expect(index).toContain('from "./suyuan/register.ts"');
    expect(functionBody(index, "broadcast")).toContain("suyuanFrame(payload)");
  });

  it("the app runs the fork's hook, shows the push switch, and leaves notifications to push where it is on", () => {
    expect(functionBody(source("src/App.tsx"), "Shell")).toContain("useSuyuan(state, dispatch)");
    expect(functionBody(source("src/components/NotificationSettingsRows.tsx"), "NotificationRows")).toContain("<WebPushRow />");
    expect(functionBody(source("src/lib/notify.ts"), "showNotification")).toContain("if (pushHandlesNotifications() && !frame.forPerson) return;");
  });

  it("the page loads the last-screen cover before anything renders, and the connecting line keeps the hooks its CSS matches", () => {
    // A regex, not the line as a string: scripts/ci-scope.test.ts would read the string as this test importing the module.
    expect(source("src/main.tsx")).toMatch(/^import "@\/suyuan\/last-frame";/m);
    const loading = source("src/App.tsx");
    expect(loading).toContain("<main data-app-loading={loading.text}");
    expect(loading).toContain('<Loader2 size={20} className="animate-spin" />');
    expect(loading).toContain('<div className="text-[14px]">{t(loading.text)}</div>');
  });

  it("the chats keep the hooks the last-screen cover finds them by: the transcript log and the two buttons' wording", () => {
    for (const view of ["src/components/ChatView.tsx", "src/components/GroupView.tsx"]) {
      expect(source(view)).toContain('role="log"');
      expect(source(view)).toContain('{t("chat.showLater", { count: laterCount })}');
    }
    expect(source("src/components/JumpToLatestButton.tsx")).toContain('title={t("chat.jumpToLatest")}');
  });

  it("a reply's table card keeps the hooks steady-tables.css finds its table by, and a width that ignores its content", () => {
    expect(source("src/suyuan/use-suyuan.ts")).toMatch(/^import "\.\/steady-tables\.css";/m);
    expect(source("src/components/ReplyBlocks.tsx")).toMatch(/data-reply-table className="[^"]*\bw-full\b/);
    expect(source("src/components/RichTable.tsx")).toContain('className="chat-table"');
    // A table sized by its card alone would collapse if the card shrank to its content.
    for (const view of ["src/components/ChatView.tsx", "src/components/GroupView.tsx"]) {
      expect(source(view)).toContain('tabled ? "w-full" : "w-fit"');
    }
  });

  it("a bot's message keeps the hooks wide-replies.css widens it by, and a room's shows the chat's two buttons", () => {
    expect(source("src/suyuan/use-suyuan.ts")).toMatch(/^import "\.\/wide-replies\.css";/m);
    const time = '"self-end pb-1 text-[11px] tabular-nums text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100';
    const chat = source("src/components/ChatView.tsx");
    expect(chat).toContain('<div {...{ [MESSAGE_ROW]: "" }} className={cn("group flex w-full flex-col", user ? "animate-msg-in items-end" : "items-start"');
    expect(chat).toContain('data-chat-bubble={simple ? "simple" : ""}');
    expect(chat).toContain(time);
    const room = source("src/components/GroupView.tsx");
    expect(room).toContain('<div {...{ [MESSAGE_ROW]: "" }} className={cn("group flex w-full flex-col", user ? "items-end" : "items-start")}>');
    expect(room).toContain('data-chat-bubble={simple ? "simple" : ""}');
    expect(room).toContain(time);
    expect(room).toContain('menu={simple ? [...replyAndCopy(() => onReply(m), botText), ...botMenu] : botMenu}>');
    expect(source("src/components/ReplyBlocks.tsx")).toContain("data-reply-blocks");
  });

  it("the phone's bot list keeps the button and the drawer the left-edge swipe opens it by", () => {
    const hook = functionBody(source("src/suyuan/use-suyuan.ts"), "useSuyuan");
    expect(hook).toContain("useEffect(() => installSwipeBack(), []);");
    expect(hook).toContain("useEffect(() => hideBackButton(backLabel), [backLabel]);");
    expect(source("src/components/RoomHeader.tsx")).toContain('className="@container/roomhead px-5 py-3 pl-11 md:pl-5"');
    expect(source("src/components/RoomHeader.tsx")).toContain('"@container/roomhead px-5 py-3",\n          "pl-11 md:pl-5",');
    const app = source("src/App.tsx");
    expect(app).toContain('aria-label={t("app.openBotList")}');
    expect(app).toContain("aria-expanded={drawerOpen}");
    expect(app).toContain("onClick={() => setDrawerOpen(true)}");
    const sidebar = source("src/components/Sidebar.tsx");
    expect(sidebar).toMatch(/<aside\n[^>]*\n\s+data-sidebar\n/);
    expect(sidebar).toContain('open ? "max-md:translate-x-0" : "max-md:-translate-x-full"');
  });

  it("rooms on Auto ask the fork's router who answers, and the app hears room routing is on", () => {
    const index = source("server/index.ts");
    expect(index).toContain("const decider = withRoomRouter(createDecider({ config: () => cfg, dataDir: DATA_DIR }), () => cfg);");
    expect(index).toContain("decideRoomResponder(decider, roomRoutingInput(group.name, routedText(text, replyTo), ");
    expect(index.match(/roomRoutingReady\(cfg\)/g)).toHaveLength(3);
    expect(index).toContain("decider: withRoomRouterStatus(describeDecider(cfg), cfg),");
    // Every "can rooms route?" question counts the router: an upstream deciderReady(…, "roomRouting") anywhere would not.
    const asks = readdirSync(join(ROOT, "server"), { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.startsWith("suyuan"))
      .filter((file) => /deciderReady\([^)]*"roomRouting"/.test(source(join("server", file))));
    expect(asks).toEqual([]);
    expect(source("src/lib/group-routing.ts")).toContain("return Boolean(config?.decider?.enabled && config.decider.jobs.roomRouting);");
    // room-router.css rewords the line under a routed reply, found by its test id.
    expect(source("src/suyuan/use-suyuan.ts")).toMatch(/^import "\.\/room-router\.css";/m);
    expect(source("src/components/RoomQueueList.tsx")).toContain('<div data-testid="routed-by" className="mt-1 px-1 text-[11px] text-ink-secondary">');
  });

  it("the first-reply notice stays off: the fork sets the variable the rescue reads each time it arms", () => {
    expect(source("server/suyuan/register.ts")).toContain('process.env.OMB_FIRST_REPLY_NOTICE_MS ??= "0";');
    const rescue = source("server/first-reply-rescue.ts");
    expect(functionBody(rescue, "firstReplyNoticeMs")).toContain("const raw = env.OMB_FIRST_REPLY_NOTICE_MS?.trim();");
    expect(rescue).toContain("const ms = firstReplyNoticeMs();\n    if (ms <= 0) return;");
  });

  it("a chat's window counts only drawn rows, and a chat too short to scroll pages older messages in", () => {
    const viewport = source("src/hooks/use-transcript-viewport.ts");
    expect(viewport).toContain("const tailStart = drawnTailStart(messages, TRANSCRIPT_WINDOW_SIZE);");
    expect(viewport.split("const start = drawnExpandStart(messages, startIndex, TRANSCRIPT_WINDOW_SIZE);")).toHaveLength(3);
    expect(viewport).toContain("useFillShortChat(scrollRef, threadId, { shown: transcriptShown, following: follow, startIndex, hasMore, olderPending, count: messages.length });");
    expect(functionBody(source("src/lib/transcript-window.ts"), "followWindowStart")).toContain("const tail = drawnTailStart(messages, TRANSCRIPT_WINDOW_SIZE);");
  });

  it("the Chief's team_threads and team_thread_read are in the catalog, the call switch, the read-only list and the internal routes", () => {
    expect(source("server/drivers/agents-catalog.ts")).toContain("...CHIEF_READ_TOOL_DEFINITIONS,");
    expect(source("server/drivers/agents-catalog.ts")).toContain('"team_threads", "team_thread_read",');
    expect(source("server/drivers/agents-call.ts")).toContain("if (CHIEF_READ_TOOL_NAMES.has(name)) return callChiefReadTool(name, args, context);");
    expect(source("server/agent-tool-policy.ts")).toContain('"team_threads",\n  "team_thread_read",');
    // They ride list_threads's route, so they get its sender, its fence on shown threads and its capability check.
    expect(source("server/routes/internal-threads.ts")).toContain("const chiefRead = createChiefReadRoutes(deps);");
    // The store handed in must carry what the read needs: the tail of a thread, and whether the caller is in a room.
    expect(source("server/routes/internal-threads.ts")).toContain('"messagesTail" | "groupByThread">');
    expect(source("server/routes/internal-threads.ts")).toContain("return async (ctx) => (await chiefRead(ctx)) === PASS ? threads(ctx) : undefined;");
    expect(source("server/index.ts")).toMatch(/createInternalThreadRoutes\(\{[^]*?shown: \(id\) => !proactive\.fence\.confines\(id\)/);
    // A confined turn gets neither tool: outside-fence.ts does not list the routes.
    expect(source("server/host/outside-fence.ts")).not.toContain("team-thread");
  });
});
