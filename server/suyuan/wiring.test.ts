// suyuan fork: the few lines in upstream files that plug the fork in. A daily merge of upstream that drops one of them
// would silently switch a feature off, since every other test only exercises the fork's own files; this one goes red.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { THREAD_FACTS } from "./thread-facts.ts";

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

  it("server/index.ts watches config.json for edits made outside the app, and never stops a turn to apply one", () => {
    const index = source("server/index.ts");
    expect(index).toContain('import { watchConfigFile } from "./suyuan/config-reload-host.ts";');
    expect(index).toContain("if (!hostedModels) watchConfigFile({ cfg, engines: () => engineLaunches(providerConfigs()), working: () => store.bots.some((bot) => botHasActiveTurn(bot.id)) || store.groups.some(groupIsWorking) || Boolean(routines?.hasActiveRuns()), reloadEngines: reloadProviders,");
    expect(index).toContain('changed: (keys) => { registry.forgetSnapshots(); if (keys.includes("signIn")) { sessions.membershipChanged(); sessions.revalidateEmailSessions(); } if (keys.includes("cacheKeepWarm")) cacheKeepWarm.refresh(); broadcast({ kind: "config", ...configStatus() }); if (keys.includes("threads")) drainQueuedSends(); } });');
  });

  it("the app runs the fork's hook, shows the push switch, and leaves notifications to push where it is on", () => {
    expect(functionBody(source("src/App.tsx"), "Shell")).toContain("useSuyuan(state, dispatch)");
    expect(functionBody(source("src/components/NotificationSettingsRows.tsx"), "NotificationRows")).toContain("<WebPushRow />");
    expect(functionBody(source("src/lib/notify.ts"), "showNotification")).toContain("if (pushHandlesNotifications() && !frame.forPerson) return;");
  });

  it("the page loads the black-screen log and the last-screen cover before anything renders, and the connecting line keeps the hooks its CSS matches", () => {
    // A regex, not the line as a string: scripts/ci-scope.test.ts would read the string as this test importing the module.
    expect(source("src/main.tsx")).toMatch(/^import "@\/suyuan\/last-frame";/m);
    expect(source("src/main.tsx")).toMatch(/^import "@\/suyuan\/lifecycle-log";/m);
    expect(source("src/main.tsx")).toMatch(/^import "@\/suyuan\/theme-color";/m);
    const loading = source("src/App.tsx");
    expect(loading).toContain("<main data-app-loading={loading.text}");
    expect(loading).toContain('<Loader2 size={20} className="animate-spin" />');
    expect(loading).toContain('<div className="text-[14px]">{t(loading.text)}</div>');
  });

  it("the composer drops its Stop button while there is text or an attachment to send, unless the field is disabled", () => {
    expect(source("src/components/Composer.tsx")).toContain("{(simpleDock ? stoppable : busy) && !locked && (!hasContent || blocking || attachmentPending) && (");
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

  it("a table card keeps the hooks phone-tables.css reshapes it by", () => {
    expect(source("src/suyuan/use-suyuan.ts")).toMatch(/^import "\.\/phone-tables\.css";/m);
    expect(source("src/suyuan/use-suyuan.ts")).toContain("useEffect(() => installTablePlate(), []);");
    const table = source("src/components/RichTable.tsx");
    expect(table).toContain("<div data-table-card className={TABLE_CARD}");
    expect(table).toContain('className="table-plate ');
    expect(table).toContain("touch:pt-11");
    expect(table).toContain('sort?.column === index ? "opacity-100" : "opacity-0 group-hover/th:opacity-100');
    expect(source("src/components/ReplyBlocks.tsx")).toContain("data-reply-table");
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

  it("the phone never pinch-zooms, and a stored picture is served with a long cache", () => {
    // no-zoom.ts caps the scale on this tag at run time.
    expect(source("index.html")).toContain('<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />');
    expect(source("src/suyuan/use-suyuan.ts")).toMatch(/^import "\.\/no-zoom\.css";/m);
    expect(functionBody(source("src/suyuan/use-suyuan.ts"), "useSuyuan")).toContain("useEffect(() => installNoZoom(), []);");
    expect(functionBody(source("src/suyuan/use-suyuan.ts"), "useSuyuan")).toContain("useEffect(() => installPreviewZoom(), []);");
    // preview-zoom.ts finds the picture by these classes and roles.
    expect(source("src/components/AttachmentPreview.tsx")).toContain('"block max-h-full max-w-full rounded-lg object-contain');
    expect(source("src/components/AttachmentPreview.tsx")).toContain('aria-modal="true"');
    expect(source("server/routes/threads.ts")).toContain('"cache-control": attachmentCacheControl(attachment.mime, viewerFor(auth).kind === "all" && !member && !deps.memberDefaultBot && !workspaceAccess),');
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

  it("a tap on a bot's reply shows its buttons at the finger, and the phone's Inbox is a button beside the +", () => {
    expect(functionBody(source("src/suyuan/use-suyuan.ts"), "useSuyuan")).toContain("useEffect(() => installTrayAtFinger(), []);");
    // The tap that would hide a reply's showing buttons first asks whether it moves them to another block.
    const actions = source("src/components/MessageActions.tsx");
    expect(actions).toContain("const moved = trayMoves(event);");
    expect(actions).toContain("setTapped((value) => moved || !value);");
    // tray-at-finger.ts tells a reply's blocks apart by these marks.
    const blocks = source("src/components/ReplyBlocks.tsx");
    expect(blocks).toContain("data-reply-blocks");
    expect(blocks).toContain("<div key={index} data-reply-table ");
    expect(blocks).toContain('<div key={index} data-chat-bubble="simple" ');
    // phone-code.css hides a code block's pill until table-plate.ts marks the block, found by these two hooks.
    expect(source("src/suyuan/use-suyuan.ts")).toMatch(/^import "\.\/phone-code\.css";/m);
    const code = source("src/components/CodeBlock.tsx");
    expect(code).toContain('<div data-code-plate className="absolute end-1 top-1 ');
    expect(code).toContain('className="chat-code-block group/code relative ');
    const sidebar = source("src/components/Sidebar.tsx");
    expect(sidebar).toMatch(/import \{ PhoneInboxButton \} from "@\/suyuan\/PhoneInboxButton";/);
    // On the + button's line: the file's length is pinned (scripts/testing/file-size-ratchet.test.ts).
    expect(sidebar).toContain("{phone && <PhoneInboxButton onOpened={onClose} />}{plusControl}");
    expect(sidebar).toContain("{!q && !phone && <SidebarInboxRow ");
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

  it("the phone's bot list words its times and leads with the newest by list-order.ts, and a tile's working dot sits apart from its unread one", () => {
    const sidebar = source("src/components/Sidebar.tsx");
    expect(sidebar).toMatch(/import \{ listTime, recentBotsFirst, rowAt \} from "@\/suyuan\/list-order";/);
    expect(sidebar).toContain("              {listTime(rowAt(bot, last.at))}\n");
    expect(sidebar).toContain("= { ...saved, ...(simple ? recentBotsFirst(visibleMessages) : activeBotsFirst)(saved, (bot) => {");
    const tiles = source("src/components/SidebarTiles.tsx");
    expect(tiles).toContain(') : unread ? dot("unread-dot", unreadTone())\n          : null}\n        {working ? (workingDotShown() ? corner("working-dot", "bg-success") : null)');
    expect(tiles).toContain('<span data-testid="chief-badge" className={cn("absolute -left-px -top-px flex');
  });

  it("the phone list's avatar row is lifted by phone-header.css, found by the row's data attribute", () => {
    expect(source("src/suyuan/use-suyuan.ts")).toMatch(/^import "\.\/phone-header\.css";/m);
    expect(source("src/components/Sidebar.tsx")).toContain('data-sidebar-top-row={corner ? "corner" : true}');
    expect(source("src/suyuan/phone-header.css")).toContain('[data-sidebar-top-row="true"].max-md\\:h-16');
    // The lift needs that row to be 64px high on a phone with its content centred.
    const sidebar = source("src/components/Sidebar.tsx");
    expect(sidebar).toContain('density !== "icons" && !simpleDesk && !lights && "h-12 max-md:h-16"');
    expect(sidebar).toContain('data-sidebar-top-row={corner ? "corner" : true}\n        className={cn(\n          "flex items-center",');
  });

  it("the first-reply notice stays off: the fork sets the variable the rescue reads each time it arms", () => {
    expect(source("server/suyuan/register.ts")).toContain('process.env.OMB_FIRST_REPLY_NOTICE_MS ??= "0";');
    const rescue = source("server/first-reply-rescue.ts");
    expect(functionBody(rescue, "firstReplyNoticeMs")).toContain("const raw = env.OMB_FIRST_REPLY_NOTICE_MS?.trim();");
    expect(rescue).toContain("const ms = firstReplyNoticeMs();\n    if (ms <= 0) return;");
  });

  it("a Claude conversation is never folded by OpenMausBot on its own: Claude Code compacts it in its session", () => {
    const index = source("server/index.ts");
    expect(index).toContain('import { engineCompactsItself } from "./suyuan/native-compact.ts";');
    expect(functionBody(index, "compactConversation")).toContain("(cfg.context?.autoCompact === false || engineCompactsItself(instance.driverKind))");
  });

  it("the app starts with the fork's count of each bot's latest messages", () => {
    const store = source("src/state/store.tsx");
    expect(store).toMatch(/; import \{ BOOT_MESSAGE_COUNT \} from "@\/suyuan\/boot-messages"; \/\/ suyuan fork$/m);
    expect(store).toContain('api(`/api/bots?messages=${BOOT_MESSAGE_COUNT}`).then((answer) => snapshotArrays(answer, "bots"))');
  });

  it("a chat's window counts only drawn rows, and a chat too short to scroll pages older messages in", () => {
    const viewport = source("src/hooks/use-transcript-viewport.ts");
    expect(viewport).toContain("const tailStart = drawnTailStart(messages, TRANSCRIPT_WINDOW_SIZE);");
    expect(viewport.split("const start = drawnExpandStart(messages, startIndex, TRANSCRIPT_WINDOW_SIZE);")).toHaveLength(3);
    expect(viewport).toContain("useFillShortChat(scrollRef, threadId, { shown: transcriptShown, following: follow, startIndex, hasMore, olderPending, count: messages.length });");
    expect(functionBody(source("src/lib/transcript-window.ts"), "followWindowStart")).toContain("const tail = drawnTailStart(messages, TRANSCRIPT_WINDOW_SIZE);");
  });

  it("the composer's voice-call button and the + menu's call modes wait for the Settings switch", () => {
    const composer = source("src/components/Composer.tsx");
    expect(composer).toContain("const voiceButton = useVoiceButton() || calling;");
    expect(composer).toContain("const callShown = voiceButton && (!simpleDock || (!hasContent && !stopInSlot));");
    // With the button hidden, an empty composer on a phone or in Simple mode keeps a dimmed, disabled Send in the slot.
    expect(composer).toContain("const sendIdle = !hasContent && !callShown && (singleRow ? !busy : simpleDock && !stopInSlot);");
    expect(composer).toContain("{(hasContent || sendIdle) && !locked && (");
    expect(composer).toContain('look={sendIdle ? { ...slot.button, className: cn(slot.button.className, "opacity-40") } : slot.button}');
    expect(composer).toContain("disabled={attachmentPending || sendIdle} onSend");
    expect(composer).toContain("callBotId={voiceButton && bot && !group ? bot.id : undefined}");
    expect(source("src/components/SettingsModal.tsx")).toContain("<TalkShortcutRow />\n            <VoiceButtonRow />");
    expect(source("src/components/SettingsSimplePages.tsx")).toContain("<TalkShortcutRow />\n            <VoiceButtonRow />");
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

  it("coordinate_bots lets a notice into a thread someone else opened only through the relay gate, and hands no level down into one", () => {
    expect(source("server/host/work-thread.ts")).toContain("if (usable && input.notice && !task.openedBy?.roomLane && input.others?.(task)) return task;");
    const index = source("server/index.ts");
    expect(index).toContain("others: EXTERNAL ? undefined : relayGate({ personBehind: teammatePrompts.personBehind, outside: outsideLineage.handsNoLevel, readableFrom: threadReadableFrom, openPersonCard }, internalSender.id, internalCapability.threadId)");
    expect(index).toContain("if (!continued || continued.openedBy?.botId === internalSender.id) delegatedLevel.apply(internalSender, internalCapability.threadId, internalCapability.roomHandoffId ?? generation, recipient, target.threadId);");
  });

  it("a phone in Simple mode leads its home with the desk's tiles, and a long press opens a tile's menu", () => {
    const sidebar = source("src/components/Sidebar.tsx");
    // One name for "this home has tiles", on the line that defines simpleDesk: the file's length is pinned.
    expect(sidebar).toContain("const simpleDesk = simple && !phone, tiled = simple; //");
    expect(sidebar).toContain("const saved = tiled ? withPrimaryTile(parts, ");
    expect(sidebar).toContain("...(pinnedBots.length > 0 && !universalPins && !tiled ? [PINNED_SECTION_ID] : []),");
    expect(sidebar).toContain("const showPinnedCircleThreads = !tiled && pinnedCircleThreadListVisible(");
    expect(sidebar).toContain("const tiles = tiled && (primary !== null || pinnedBots.length > 0);");
    expect(sidebar).toContain("{universalPins && pinnedBots.length > 0 && !tiled && (");
    expect(sidebar).toContain("{tiles && <SidebarTileGrid primary={primary} pinned={pinnedBots} row={botRow} corner={corner} />}");
    // tile-menu.ts and phone-tiles.css find a tile, its menu, its colour and the open bot's tile by these.
    const tile = source("src/components/SidebarTiles.tsx");
    expect(tile).toContain('data-sidebar-tile={primary ? "primary" : "pinned"}');
    expect(tile).toContain("onContextMenu={(event) => openBotContextMenu(onMenu, bot.id, event)}");
    expect(tile).toContain('aria-current={selected && !renaming ? "page" : undefined}');
    expect(tile).toContain("bg-[var(--tile)]");
    expect(functionBody(source("src/suyuan/use-suyuan.ts"), "useSuyuan")).toContain("useEffect(() => installTileMenu(), []);");
    expect(source("src/suyuan/use-suyuan.ts")).toMatch(/^import "\.\/phone-tiles\.css";/m);
  });

  it("a tool call written again as text is cut where replies are stored and where they are drawn", () => {
    const guard = source("shared/system-message-guard.ts");
    expect(guard).toMatch(/^import \{ stripToolEcho \} from "\.\/suyuan\/tool-echo\.ts";/m);
    expect(functionBody(guard, "stripLeakedSystemHarnessMessages")).toContain('result = stripToolEcho(result.replace(ORPHANED_TAG_REGEX, ""));');
    // The guard is the one place both ends pass a bot's text through: tool-echo.ts counts on these calls.
    expect(source("server/drivers/acp/core.ts")).toContain("const text = stripLeakedSystemHarnessMessages(raw);");
    expect(source("src/components/ChatView.tsx")).toContain("const text = user ? rawText : stripLeakedSystemHarnessMessages(rawText);");
    expect(source("src/components/GroupView.tsx")).toContain('const rawText = user ? (m.text ?? "") : stripLeakedSystemHarnessMessages(m.text ?? "");');
  });

  it("a bot has one home: the server names it, no bot closes it or works in it, and the app shows a bot for its home alone", () => {
    const index = source("server/index.ts");
    // The home is what clients get as mainThreadId; a Team Cloud keeps upstream's rule.
    expect(functionBody(index, "botMainThread")).toContain("return (CLOUD_TEAM ? mainThread : homeThread)(mainThreadTasks(botId), store.bot(botId)?.threadId, store.bot(botId)?.mainThreadChoice);");
    expect(index).toContain("home: (task) => isHome(store, target.botId, task.threadId) });");
    expect(index).toContain('childTask?.openedBy?.kind === "work" && childTask.openedBy.botId === parent.botId && !isHome(store, child.botId, child.threadId)) {');
    const work = source("server/host/work-thread.ts");
    expect(work).toContain("(task) => also(task) && reach(task) && !(input.home?.(task) && !input.notice));");
    expect(work).toContain("&& !task.openedBy.roomLane && !input.notice && input.home?.(task)) throw new Error(homeTakesNoWork(input.botName));");
    expect(source("server/routes/internal-threads.ts")).toContain("if (isHome(store, owner.id, threadId)) return json(res, 409, { error: homeStaysOpen(owner.name) });");
    // The app: the shell says whether the thread list is hidden; then the click on a bot, its rows and status, its dot and
    // count, and the composer of a background run follow the home.
    expect(functionBody(source("src/suyuan/use-suyuan.ts"), "useSuyuan")).toContain("noteThreadsShown(useShowThreads());");
    expect(functionBody(source("src/state/thread-navigation.ts"), "markedThread")).toContain("(foreground(bot).tasks ?? [])");
    expect(functionBody(source("src/components/SidebarBotActivity.tsx"), "sidebarBotActivityTasks")).toContain("const tasks = foreground(bot).tasks ?? [{");
    expect(functionBody(source("src/lib/bot-unread.ts"), "botShowsUnread")).toContain("return foreground(bot).tasks!.some(");
    const chat = source("src/components/ChatView.tsx");
    expect(chat).toContain('const background = readsBackgroundRun(profile, bot.messages), canWrite = useCanWriteIn(bot.threadId, background ? "view" : bot.yourAccess);');
    expect(chat).toContain("background ? <BackgroundRunBar bot={profile} /> : <NewConversationInstead");
    // A run another bot passed on reads "荔枝 → shopping · <title>" in the header (src/suyuan/relay.ts).
    const pill = source("src/components/ChatHeadPill.tsx");
    expect(pill).toContain("const passed = passedOnBy(bot); // suyuan fork");
    expect(pill).toContain("<PassedOnFrom passed={passed} />\n      <BotAvatar bot={bot} size={24} {...avatar} />");
    expect(pill).toContain('{passed ? <span aria-hidden="true" className="shrink-0 text-ink-tertiary">·</span> : <ChevronRight');
    // A simple row quotes the last line said in the bot's own conversation, never a live step (src/suyuan/quiet-row.tsx),
    // and the chat leaves out all-English lines along the way (src/suyuan/quiet-english.ts).
    const sidebar = source("src/components/Sidebar.tsx");
    expect(sidebar).toContain('import { QuietRowLine, quietRow } from "@/suyuan/quiet-row";');
    expect(sidebar).toContain("{working && !quietRow(simpleRow) ? (\n                <SidebarWorkingStep bot={bot} last={last} />");
    expect(sidebar).toContain("{quietRow(simpleRow) ? (teammateWait ? waitingOnLine(bot) : <QuietRowLine bot={bot} visible={visible} instances={instances} waiting={waiting} />) : waiting ?");
    expect(chat).toContain('import { quietChat } from "@/suyuan/quiet-english";');
    expect(chat).toContain("messages = useMemo(() => quietChat(visibleMessages({ messages: allMessages, activeLeafId }), advanced, turnRuns)");
    // No other conversation is offered: a bot's and a room's ⋯ menu list no threads and start none, the bot's menu has no
    // thread items (Set as main thread among them, so the home stays where it is), the bot panel lists no conversations,
    // the new-thread shortcut does nothing, and a routine's results can go to the home alone.
    for (const menu of ["src/components/ChatMoreMenu.tsx", "src/components/RoomMoreMenu.tsx"]) {
      expect(source(menu)).toMatch(/const threads = showThreads \|\| oneConversation\(\) \? \[\] : orderedThreadList\(/);
      expect(source(menu)).toContain('...(showThreads || oneConversation() ? [] : [{\n      key: "new-thread",');
    }
    expect(source("src/components/SidebarBotMenu.tsx")).toContain('const threads = oneConversation() ? [] : [divider("threads"), newThread, viewThreads, setMain];');
    expect(source("src/components/bot-panel/DetailsTab.tsx")).toContain("{threadsShownNow() && <BotConversations bot={bot} />}");
    expect(source("src/App.tsx")).toContain('if (!e.repeat && selected && selected.yourAccess !== "view" && threadsShownNow()) dispatch({ type: "newTask", botId: selected.id });');
    expect(source("src/components/routines/ResultsDestination.tsx")).toContain("const tasks = listedThreads(bot, (bot?.tasks ?? []).filter((task) => !task.routineRunId));");
  });

  it("a bot's Recent work and what it is told about threads come from the fork", () => {
    const index = source("server/index.ts");
    // A regex, as above: the import line written as a string would read to ci-scope as this test importing the module.
    expect(index).toMatch(/^import \{ parseSince, parseUntil, turnOutcomeLine \} from "\.\/recent-work\.ts"; import \{ recentWork, recentWorkPrompt \} from "\.\/suyuan\/recent-work\.ts";/m);
    // The 1:1 turn and the room turn both build the section from that import.
    expect(index).toContain('{ id: "recent", label: "Recent work", text: recentWorkPrompt(recentWork(recentWorkSources(bot), bot, {');
    expect(index).toContain('{ id: "recent", label: "Recent work", text: recentWorkPrompt(recentLines) },');
    expect(index).toContain("const recentLines = recentWork(recentWorkSources(bot), bot, {");
    expect(functionBody(index, "recentWorkSources")).toContain("awaitingAnswer: (threadId: string) => coordinator.awaitingAnswer(threadId),");
    // recent-work.ts finds a teammate's ask by the request line the coordinator writes when the work starts.
    expect(index).toContain('roomRequest: { id: request.id, phase: "request" },\n          from: sender ? { botId: sender.id, name: sender.name, color: sender.color } : undefined,');
    expect(source("server/system-prompt.ts")).toContain("export const THREADS_PROMPT = threadFacts(");
    expect(source("server/drivers/agents-catalog.ts")).toContain("].map(withThreadFacts).map((tool) => {");
    expect(source("server/drivers/agents-call.ts")).toContain("return { text: threadFacts(`Closed #${String(r.title)}");
    // Every phrase thread-facts.ts swaps is still upstream's, word for word: one upstream reworded would stop being swapped.
    const upstream = source("server/system-prompt.ts") + source("server/drivers/agents-catalog.ts") + source("server/drivers/agents-call.ts");
    for (const [phrase] of THREAD_FACTS) expect(upstream).toContain(JSON.stringify(phrase).slice(1, -1));
  });

  it("the fork can add to the sections that ride outside the system prompt, and the split still reads that set", () => {
    const prompt = source("server/system-prompt.ts");
    expect(prompt).toContain("export const VOLATILE_SECTIONS = new Set([");
    expect(functionBody(prompt, "buildSystemPrompt")).toContain("VOLATILE_SECTIONS.has(section.id) === volatile");
    expect(source("server/suyuan/register.ts")).toMatch(/^import "\.\/steady-prompt\.ts";/m);
  });

  it("after a compaction the running turn's volatile half goes back to Claude on hooks of its own", () => {
    const index = source("server/index.ts");
    expect(index).toContain('import { noteTurnVolatile, volatileHookReply } from "./suyuan/compact-volatile.ts";');
    // Each turn notes its half under the generation its hooks bearer carries.
    expect(index).toContain("integrations.hooks = hooksIntegration(bot.id, threadId, dispatchClaimId);");
    expect(index).toContain("noteTurnVolatile(threadId, dispatchClaimId, prompt.volatile);");
    expect(index).toContain("integrations.hooks = hooksIntegration(bot.id, threadId, internalGeneration);");
    expect(index).toContain("noteTurnVolatile(threadId, internalGeneration, roomSystem.volatile);");
    expect(index).toContain("return json(res, 200, volatileHookReply(body, internalCapability, () => internalCapabilityIsActive(internalCapability)) ?? ingestEngineHook(internalCapability, body));");
    const claude = source("server/drivers/claude.ts");
    expect(claude).toMatch(/^import \{ volatileHookEntries \} from "\.\.\/suyuan\/compact-volatile\.ts";/m);
    expect(functionBody(claude, "claudeHookSettings")).toContain("SessionStart: [...entry, ...volatileHookEntries(hook)]");
    expect(source("server/hooks/omb-hook.ts")).toContain("body: JSON.stringify({ event, payload, ...(process.argv[2] ? { slot: process.argv[2] } : {}) }),");
    // Why it is needed: the driver forgets the half at a compaction and only the next turn re-sends it.
    expect(claude).toContain("session.volatile = null; // only the system prompt survives a compaction");
  });

  it("a query with Chinese in it is searched by containment, and auto-recall cuts Chinese into words and counts them", () => {
    const db = source("server/message-db.ts");
    expect(db).toContain('import { hanRecallMemory, hanRecallMessages, hasHan } from "./suyuan/han-search.ts";');
    expect(functionBody(db, "recallMessages")).toContain("if (hasHan(query)) return hanRecallMessages(db(), query, threadIds, limit, range, mode);");
    expect(functionBody(db, "recallMemory")).toContain("if (hasHan(query)) return hanRecallMemory(db(), query, botId, limit, mode);");
    const recall = source("server/recall.ts");
    expect(recall).toContain('import { hanEnoughMatches, hasHan, recallTerms } from "./suyuan/han-search.ts";');
    expect(recall).not.toMatch(/import \{[^}]*\brecallTerms\b[^}]*\} from "\.\/message-db\.ts"/);
    expect(functionBody(recall, "enoughMatches")).toContain("return hasHan(query) ? hanEnoughMatches(query, plain(snippet), MIN_TERMS_FOR_TWO) :");
  });
  it("keeps the quiet dots wired into the list row, its markers and the tiles", () => {
    expect(source("src/components/Sidebar.tsx")).toContain('activity={working ? (workingDotShown() ? "working" : null)');
    expect(source("src/components/SidebarRowMarkers.tsx")).toContain('waiting ? "bg-warning" : unreadTone())');
    expect(source("src/components/SidebarTiles.tsx")).toContain('unread ? dot("unread-dot", unreadTone())');
    expect(source("src/components/SidebarTiles.tsx")).toContain('working ? (workingDotShown() ? corner("working-dot", "bg-success") : null)');
  });

  it("keeps the inbox to what waits on the person: no work dot, read news gone, background runs read with their conversation", () => {
    const sidebar = source("src/components/Sidebar.tsx");
    expect(sidebar).toContain("running={false /* suyuan fork: the inbox lights only for what waits on the person */}");
    expect(sidebar).not.toContain('data-testid="teammate-wait-dot"');
    expect(sidebar).toContain(': queued && !waiting && !teammateWait ? "queued" : null} />}');
    expect(sidebar).toContain("teammateWait ? ` · ${waitingOnLine(bot)}`");
    const tiles = source("src/components/SidebarTiles.tsx");
    expect(tiles).toContain("teammateWait ? waitingOnLine(bot)");
    expect(tiles).toContain(": teammateWait ? null // suyuan fork");
    expect(functionBody(source("src/suyuan/use-suyuan.ts"), "useSuyuan")).toContain("noteBotNames(state.bots);");
    expect(functionBody(source("src/suyuan/use-suyuan.ts"), "useSuyuan")).toContain("useInboxCatchUp(inboxCatchUpKey(state), loaded);");
    const panel = source("src/components/inbox/InboxPanel.tsx");
    expect(panel).toContain("const listed = useUnreadRows(view);");
    expect(panel).toContain("const rows = listed.filter((row) => matchesSearch(row, query));");
    expect(source("server/host/place-inbox.ts")).toContain("if (!line.seen && (line.threadId === threadId || deps.readsWith?.(line.threadId, threadId)) && lineFor(auth, line))");
    const index = source("server/index.ts");
    expect(index).toContain("createPlaceInbox({ dataDir: DATA_DIR, readsWith: (lineThread, opened) => suyuanReadsWith(store, lineThread, opened, (id) => delegatorOf(id)?.threadId ?? null),");
    expect(index).toContain("...(awaiting.has(task.threadId) && !task.busy ? waitingOnWire(teammatesAwaited(task.threadId)) : {})");
    expect(index).toContain("...(awaiting.has(bot.threadId) && !threadBusy(bot.id, bot.threadId) ? waitingOnWire(teammatesAwaited(bot.threadId)) : {})");
    expect(index).toContain("teammatesAwaited = (threadId) => coordinator.outstandingDirect(threadId).map((handoff) => handoff.botId);");
  });
  it("a thread a bot opens on itself is work in the runtime: it reports back and takes more messages", () => {
    // The one exception to "never hand work to an ancestor", in the three places upstream refuses it.
    const coordinator = source("server/runtime-coordinator.ts");
    expect(coordinator).toContain('import { ownOtherThreadRow } from "./suyuan/self-thread.ts";');
    expect(coordinator).toContain("const ownThread = ownOtherThreadRow(parent, target);");
    // The same words to two threads of its own are two requests: upstream's duplicate check does not look at the thread.
    expect(coordinator).toContain("&& c.brief === brief && c.mode === mode && (!ownThread || c.assignee.destination.threadId === target.threadId));");
    expect(coordinator).toContain("if (!answersSender(parent, mode, target) && !ownThread && lineage.some(n => ancestorOf(address(n), target))) throw new Error(ANCESTOR);");
    expect(coordinator).toContain('const waiting = mode === "notify" || target.groupId !== undefined || ownThread ? undefined : this.waitingOn(source.botId, target.botId);');
    expect(source("server/runtime/runtime.ts")).toContain("if (!answersSender(parent, mode, { botId: target.botId, ...target.destination }) && !ownOtherThreadRow(parent, { botId: target.botId, ...target.destination }) && lineage.some(");
    expect(source("server/host/room-access.ts")).toContain("if (from.id !== bot.id && !peerAllowed(from, bot)) return reachRefusal(from, bot, lookedAfterBy)!;");
    // What the thread and the opening conversation read.
    const envelope = source("server/runtime/envelope.ts");
    expect(envelope).toContain("`${selfBriefLine(a, names, person, (text) => quote(text, NAME_MAX))}${lineage(a, names, person)} ${levelLine(a)}");
    expect(envelope).toContain("const own = selfReportLine(a); if (own) lines.push(own);");
    // coordinate_bots: who may target itself, no approval card for it, an archived thread comes back, a second message is rework, and the row names the thread.
    const index = source("server/index.ts");
    expect(index).toContain("const coordinateBots = async (call: CoordinateBotsCall & { self?: SelfThreadOpening })");
    expect(index).toContain("return selfTargetRefusal({ opening: Boolean(sent.self), answers: Boolean(sent.answers), answeringBack: back?.botId === internalSender.id && back.threadId === sent.thread, consult: sent.consult, thread: sent.thread,");
    expect(index).toContain("handoff: handedTurn(internalCapability.roomHandoffId, (id) => coordinator.node(id)), requestLine: store.activePath(address.threadId)");
    expect(index).toContain('target.botId === internalSender.id && target.groupId ? "Choose a teammate, not yourself"');
    expect(index).toContain(": target.botId === internalSender.id && ownTargetRefusal(call) ? ownTargetRefusal(call)");
    expect(index).toContain("if (peerReviewRequired(internalSender, address.threadId) && targets.some(target => target.botId !== internalSender.id)) {");
    expect(index).toContain('const verdicts = await Promise.all(targets.map(target => target.botId === internalSender.id ? "allow" as const :');
    expect(index).toContain("if (!room && !fresh) reopenOwnThread(store, target.botId, call.thread, internalSender.id);");
    expect(index).toContain("false, call.projectId, opened, call.self?.approvalMode, call.self?.modelSelection, folder.cwd)");
    expect(index).toContain("rework: call.rework || target.botId === internalSender.id,");
    expect(index).toContain("store.appendMessage(address.threadId, ownThreadRow({ sender: internalSender, recipient, threadId: node.threadId,");
    // start_thread on yourself: only a conversation's own turn; the tool asks for the result back unless the bot says none, and the route alone keeps upstream's one-way thread.
    expect(index).toContain("const selfRefused = selfThreadRefusal({ handoff: handedTurn(internalCapability.roomHandoffId, (id) => coordinator.node(id)), requestLine: store.activePath(fromThreadId)");
    expect(index).toContain('const report = body.report === undefined ? "none" : body.report;');
    expect(index).toContain('if (report === "resume") { if (message.length > SELF_BRIEF_MAX) return json(res, 400, { error: selfBriefTooLong(message.length) });');
    expect(index).toContain('const own = await coordinateBots({ botIds: [from.id], message, rework: true, thread: "new", reply: "resume", consult: false, title, projectId, inMyFolder: false, self: inherited });');
    expect(index).toContain("self: true, report,");
    // The tool passes report on and answers with where the result goes.
    const call = source("server/drivers/agents-call.ts");
    expect(call).toContain('if (!toBotId) body.report = args.report ?? "resume";');
    expect(call).toContain('if (r.self === true && r.report === "resume") return { text: selfThreadOpenedText({ opened, title: threadTitle, threadId, botId: String(r.botId ?? BOT_ID), assignmentId: handoffIds(r)[0] ?? "" }) };');
  });


  it("archives a bot-opened thread left idle, brings it back when a turn starts there, and skips its idle summary", () => {
    const index = source("server/index.ts");
    expect(index).toContain("onThreadSeen((threadId) => warmSummaries.sawThread(threadId)); startIdleArchive({ store, busy: (botId, threadId) => threadBusy(botId, threadId) || queuedThreadPosition(botId, threadId) !== null || hasQueuedSteeredMessages(botId, threadId),");
    expect(index).toContain("waiting: (botId, threadId) => coordinator.awaitingAnswer(threadId) || Boolean(coordinator.parkedDirect(threadId)) || coordinator.activeDirect(threadId) || coordinator.awaitingTeammateThreads().has(threadId) || botWaits.all().some((wait) => wait.botId === botId && wait.threadId === threadId),");
    expect(index).toContain("  reopenIdleArchived(store, bot.id, threadId); store.setTaskClosedBy(bot.id, threadId, null);");
    expect(index).toContain("if (!unattendedBotJob(store, target.botId, target.threadId)) warmSummaries.turnCompleted(target, { ok: event.ok, contextTokens });");
    expect(source("server/host/work-thread.ts")).toContain("const usable = task !== undefined && (task.archivedAt === undefined || idleArchived(task)) && also(task);");
  });
  it("folds the New messages divider once it is on screen at the bottom", () => {
    const hook = source("src/hooks/use-unread-divider.ts");
    expect(hook).toContain("const onScreen = useDividerSeen(messageId, following, messages.length);");
    expect(hook).toContain("(following && seen.current.leftEnd) || onScreen)) seen.current.caughtUp = true;");
  });
  it("posts a plain reminder with no turn, and reads run_with off the trigger tool's schedule requests", () => {
    const index = source("server/index.ts");
    expect(index).toContain("if (!companyShutdown && !deliverPlainReminder(threadId, {");
    expect(index).toContain("const runWith = takeRunWith(request.proposal, forBot?.botId ?? from.id, runWithDeps, fullAccessForSource(from.id, fromThreadId)); if (runWith.error) return json(res, 400, { error: runWith.error });");
    expect(index).toContain("runWith.applied(proposed, fromThreadId); return json(res, 201, proposed);");
    const call = source("server/drivers/agents-call-triggers.ts");
    expect(call).toContain("if (args.run_with != null) fields.runWith = args.run_with; if (args.model_selection != null) fields.modelSelection = args.model_selection;");
    expect(call).toContain('"run_on_startup", "runOnStartup", "run_with", "model_selection", "only_if"] as const;');
    expect(source("server/drivers/agents-catalog.ts")).toContain("...RUN_WITH_SCHEMA,");
  });
  it("a routine may run a command first: the check is one of the scheduler's, and only_if reaches the request", () => {
    const index = source("server/index.ts");
    expect(index).toContain("checks: commandChecks(proactive.checks, { mayRun: runWithDeps.mayRun, cwd: (botId) => store.bot(botId)?.cwd || workspaceDir(botId) }),");
    expect(index).toContain('mayRun: (botId) => { const bot = store.bot(botId); return Boolean(bot && approvalModeFor(bot) === "full"); }');
    expect(index).toContain('routines!.update(id, { checks: on ? ["command"] : null });');
    expect(source("shared/routines.ts")).toContain('export const ROUTINE_CHECKS: readonly RoutineCheck[] = ["calendar", "mail", "runs", "command"];');
    expect(source("server/drivers/agents-call-triggers.ts")).toContain('if (typeof args.only_if === "string") fields.onlyIf = args.only_if;');
  });
  it("the Automations form offers what a run costs, and a running background run has no row with the thread list hidden", () => {
    const form = source("src/components/RoutineCalendarPage.tsx");
    expect(form).toContain("const [runWith, setRunWith] = useState(() => runWithOf(existingRoutine));");
    expect(form).toContain('...(routineTarget === "bot" ? runWithFields(runWith, description,');
    expect(form).toContain("<RunWithSelect indent={advanced} command={commandOf(existingRoutine)} value={runWith} onChange={setRunWith}");
    expect(form).toContain("existingRoutine?.prompt) : { prompt: description }),");
    expect(functionBody(source("src/components/SidebarBotActivity.tsx"), "runningRoutineRun")).toContain("return !oneConversation() && Boolean(task.routineRunId)");
  });
  it("a bot with the person's own screen server (lcu) gets the reworded Surface section and no auto pin to the built-in browser", () => {
    const index = source("server/index.ts");
    expect(functionBody(index, "turnSurfacePlan")).toContain("withoutAutoBrowserPin(store.taskByThread(bot.id, threadId), screenMcpNames(cfg, mcpServersHost.mounted(bot)))");
    expect(index).toContain("const autoPin = autoPinPatch(used, screenMcpNames(cfg, integrations.custom), store.taskByThread(bot.id, threadId)); if (autoPin) store.patchTask(bot.id, threadId, autoPin);");
    expect(index).not.toContain('if (used) store.patchTask(bot.id, threadId, { surface: used, surfaceSource: "auto" });');
    expect(index.split('text: screenMcpWording(surfacePrompt(').length - 1).toBe(2); // a bot's own turn, and its turn in a room
    expect(index).toContain('{ names: screenMcpNames(cfg, integrations.custom), browser: Boolean(integrations.browser), chose: plan.pinned === "browser" || bot.computer === "browser" }) },');
    expect(source("server/config.ts")).toContain("screenMcpServers: z.array(z.string().max(64)).max(16).optional(),");
  });
});
