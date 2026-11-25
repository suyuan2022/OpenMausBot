// suyuan fork: fast, source-level wiring checks ensuring every retained thin-fork hook stays connected to upstream files.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("suyuan-v2 thin-fork wiring", () => {
  it("filters leaked thought before storage and in older direct and room replies", () => {
    const guard = source("shared/system-message-guard.ts");
    expect(guard).toContain('from "./suyuan/thought-leak.ts"');
    expect(guard).toContain("return stripThoughtLeak(result).trim()");
    expect(guard).toContain("!hasMarkers && !hasThoughtMark(text)");
    expect(source("server/drivers/acp/core.ts")).toContain("stripLeakedSystemHarnessMessages(raw)");
    for (const file of ["ChatView.tsx", "RoomTextMessage.tsx"]) expect(source("src/components/" + file)).toContain("stripLeakedSystemHarnessMessages(");
    for (const file of ["ChatView.tsx", "GroupView.tsx"]) expect(source("src/components/" + file)).toContain("isPureLeakedSystemHarnessMessage(");
  });

  it("caps Argon in discovery, saved catalogs, live choices and native session selection", () => {
    const driver = source("server/drivers/antigravity.ts");
    expect(driver).toContain('from "../suyuan/argon-thinking.ts"');
    expect(driver).toContain("return withoutArgonHigh(catalog)");
    expect(driver).toContain("argonAtMostMedium(normalizeAntigravityTurn(turn, offered, catalog), offered)");
    const core = source("server/drivers/acp/core.ts");
    expect(core).toContain('from "../../suyuan/argon-thinking.ts"');
    expect(core).toContain('DRIVER_KIND === "antigravityAgent" ? withoutArgonHigh(catalog.models)');
    expect(core).toContain("variants: visibleThinkingLevels(DRIVER_KIND, model, variants)");
  });

  it("keeps Antigravity retry, final failure, stop and side-effect guards on the ACP turn", () => {
    const core = source("server/drivers/acp/core.ts");
    expect(core).toContain('from "../../suyuan/acp-resilience.ts"');
    expect(core).toContain("endTurn(current, ok, stopReason, support.displayName, DRIVER_KIND)");
    for (const anchor of ["const handleServerRequest =", 'case "tool_call":', 'case "tool_call_update":']) {
      expect(core.slice(core.indexOf(anchor), core.indexOf(anchor) + 140)).toContain("current.operationSeen = true");
    }
    expect(core).toContain("antigravityReplyDelta(DRIVER_KIND, current.turn.model, current.state.text, rawDelta)");
    expect(core).toContain("retryAuthenticate(DRIVER_KIND, () => state.stopped || state.settled || session.closing,");
    expect(core).toContain('() => session.host.once("authenticate", () => request("authenticate", { methodId }, INIT_TIMEOUT))');
    expect(core).toContain("if (error instanceof TransientAcpAuthError) throw error");
    expect(core).toContain("retryErrorReply(DRIVER_KIND, current, session, promptOutcome,");
    expect(core).toContain("promptOutcome = await support.promptOutcome?.(instanceId, sessionId); }, () => request(");
    expect(core).toContain("checkedPromptOutcome(DRIVER_KIND, current, final, promptOutcome)");
    const native = source("server/drivers/antigravity-turn-outcome.ts");
    expect(native).toContain("checkErrorReply: true");
    expect(native).toContain("checkErrorReply: transient");
    expect(core).toContain("e instanceof TransientAcpAuthError ? ANTIGRAVITY_UNAVAILABLE");
    const end = source("server/drivers/acp/turn-state.ts");
    expect(end).toContain('driver === "antigravityAgent" ? splitAntigravityErrorReply(ai, current.state.text)');
    expect(end).toContain("current.state.text = split.prefix");
    expect(end).toContain("split?.failure ??");
    expect(source("server/drivers/acp/startup-recovery.ts")).toContain("(error instanceof TransientAcpAuthError && error.backupMayConnect) || failure.transient");
    expect(source("server/routine-recovery.ts")).toMatch(/const NOT_RETRIED_STOPS = .*ANTIGRAVITY_UNAVAILABLE/);
  });

  it("disables speculative warm summary in register.ts and wires core suyuan hooks in server/index.ts", () => {
    const reg = source("server/suyuan/register.ts");
    expect(reg).toContain('OMB_WARM_SUMMARY ??= "0"');

    const index = source("server/index.ts");
    expect(index).toContain('from "./suyuan/register.ts"');
    expect(index).toContain("suyuanFrame(payload)");
    expect(index).toContain("webPushFor(DATA_DIR).unsubscribeBySession(sessionId)");
    expect(index).toContain("watchConfigFile(");
    expect(index).toContain("qualifyBareCodexModel(selection.model)");
    expect(index).toContain("withoutAutoBrowserPin(");
    expect(index).toContain("screenMcpWording(");
    expect(index).toContain("deliverPlainReminder(");
    expect(index).toContain("takeRunWith(");
    expect(index).toContain("commandChecks(");
    expect(index).toContain("botMainThread(botId)");
    expect(index).toContain("(CLOUD_TEAM ? mainThread : homeThread)(");
    expect(index).toContain('if (scope === "turn") coordinator.stopTurnDirect(threadId, cause)');
    expect(index).toContain("turnRunning: threadBusy");
    expect(index).toContain("validateHandoffModel(");
    expect(index).toContain("prepareTargetThreadModel(");
    expect(index).toContain("applyThreadModelPlan(");
    expect(index).toContain("revertThreadModelPlan(");
    expect(index).toContain("handoffModelNote(");
    expect(index).toContain("instanceId: b.modelSelection.instanceId");
  });

  it("wires config, attachments route, update-check, Codex alias, and ACP extra directories", () => {
    const cfg = source("server/config.ts");
    expect(cfg).toContain("screenMcpServers");

    const threads = source("server/routes/threads.ts");
    expect(threads).toContain("attachmentCacheControl(");

    const upd = source("server/update-check.ts");
    expect(upd).toContain("suyuan2022/OpenMausBot");

    const codexCat = source("server/drivers/codex-catalog.ts");
    expect(codexCat).toContain("aliasProviderForBare(");
    expect(codexCat).toContain("codexOfficialAlias(");
    expect(source("server/drivers/codex.ts")).toContain("aliasProviderArgs(");

    const acpCore = source("server/drivers/acp/core.ts");
    expect(acpCore).toContain("acpAdditionalDirectories(");
    expect(acpCore).toContain("effectiveSessionKey(");
    expect(source("server/drivers/acp/client-file-request.ts")).toContain("resolveClientPathInRoots(");
  });

  it("wires automation report turns, stop-turn-only, Chinese stop, home guard, Chief read, and tool facts", () => {
    const reports = source("server/automation-reports.ts");
    expect(reports).toContain("shouldDeliverAutomationTurn(");
    expect(reports).toContain("extractTurnReport(");
    expect(reports).toContain("collectRecoverableRoutineTurns(");

    expect(source("server/room-holds.ts")).toContain("isChineseStopWords(words)");
    expect(source("server/runtime/runtime.ts")).toContain("stopRequesterTurn(");
    expect(source("server/runtime-coordinator.ts")).toContain("stopTurnDirect(");
    expect(source("server/host/person-stop.ts")).toContain("personStopScope(");
    expect(source("server/host/work-thread.ts")).toContain("homeTakesNoWork(");

    const internalThreads = source("server/routes/internal-threads.ts");
    expect(internalThreads).toContain("createChiefReadRoutes(");
    expect(internalThreads).toContain("isHome(store, owner.id, threadId)");
    expect(internalThreads).toContain("homeStaysOpen(");

    const catalog = source("server/drivers/agents-catalog.ts");
    expect(catalog).toContain("...CHIEF_READ_TOOL_DEFINITIONS,");
    expect(catalog).toContain("].map(withThreadFacts).map(");
    expect(catalog).toContain("...RUN_WITH_SCHEMA,");
    expect(catalog).toContain('"team_threads", "team_thread_read"');

    const call = source("server/drivers/agents-call.ts");
    expect(call).toContain("callChiefReadTool(");
    expect(call).toContain("parseHandoffModelArg(");
    expect(call).toContain("threadFacts(");

    expect(source("server/system-prompt.ts")).toContain("export const THREADS_PROMPT = threadFacts(");
  });

  it("wires the lean frontend hooks and slim one-home without touching Sidebar/ChatView", () => {
    const app = source("src/App.tsx");
    expect(app).toContain("useSuyuan(state, dispatch)");
    expect(app).toContain("threadsShownNow()");

    expect(source("src/main.tsx")).toContain('import "@/suyuan/theme-color";');
    // The reopen cover and the notification's chat run before the app's script loads: main.tsx imports them first.
    expect(source("src/main.tsx")).toMatch(/^import "@\/suyuan\/boot";/m);
    expect(source("src/suyuan/boot.ts")).toContain('import "./last-frame";');
    expect(source("src/suyuan/boot.ts")).toContain("resumeOnPushTarget(location.search)");
    // Opened from a notification, the start's own return to the bot's main conversation stands aside for it.
    const store = source("src/state/store.tsx");
    expect(store).toContain('import { openingOnPush } from "@/suyuan/push-resume";');
    expect(store).toContain("launched.current = true; if (openingOnPush()) return;");
    // The cover's chat is the transcript's role="log"; the connecting line it holds back is the loading page's.
    expect(source("src/components/ChatView.tsx")).toContain('role="log"');
    expect(source("src/App.tsx")).toContain('<main data-app-loading={loading.text} className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-app text-ink-secondary">');
    expect(source("src/App.tsx")).toContain('{loading.busy && <Loader2 size={20} className="animate-spin" />}');
    expect(source("src/App.tsx")).toContain('<div className="text-[14px]">{t(loading.text)}</div>');
    // A conversation opens at its newest message: the shell notes it before the chat reads where to open.
    expect(source("src/hooks/use-transcript-viewport.ts")).toContain("const transcriptKey = `${ownerId}:${threadId}`;");
    expect(source("src/hooks/use-transcript-viewport.ts")).toContain("const remembered = readTranscriptPosition(key);");
    expect(source("src/suyuan/use-suyuan.ts")).toContain("const shown = shownChat(state);\n  openAtLatest(shown);");
    // shownChat names the chat as the shell draws it, a blank new chat under its own id.
    expect(source("src/App.tsx")).toContain("const chatBot = useMemo(() => bot && newChatBot(bot, state.newChat), [bot, state.newChat]);");
    expect(source("src/state/store.tsx")).toContain("readChatSnapshot(store.getState, readLastConversation() ?? undefined)");
    expect(source("src/lib/notify.ts")).toContain("if (pushHandlesNotifications() && !frame.forPerson) return;");
    expect(source("src/components/NotificationSettingsRows.tsx")).toContain("<WebPushRow />");
    const appPages = source("src/components/settings/pages/AppPages.tsx");
    expect(appPages.match(/<VoiceButtonRow \/>/g)).toHaveLength(2);
    expect(appPages.match(/<VoiceButtonRow \/>\n\s*<SkillBurgerRow \/>/g)).toHaveLength(2);
    expect(source("src/hooks/use-unread-divider.ts")).toContain("useDividerSeen(");

    const cal = source("src/components/RoutineCalendarPage.tsx");
    expect(cal).toContain("<RunWithSelect ");
    expect(cal).toContain("runWithFields(");

    const composer = source("src/components/Composer.tsx");
    expect(composer).toContain("useVoiceButton()");
    expect(composer).toContain("(!hasContent || blocking || attachmentPending)");

    expect(source("src/components/ChatMoreMenu.tsx")).toContain("oneConversation()");
    expect(source("src/components/RoomMoreMenu.tsx")).toContain("oneConversation()");
    expect(source("src/components/SidebarBotMenu.tsx")).toContain("oneConversation()");
    expect(source("src/components/NewThreadHeaderButton.tsx")).toContain("if (oneConversation()) return null;");
    // The phone's round account button shows a person, not "?", for a person with no name.
    const profileMenu = source("src/components/SidebarProfileMenu.tsx");
    expect(profileMenu).toContain('const nameless = (simple || circle) && initials === "?"');
    expect(profileMenu).toContain("size={rail ? 30 : circle ? 26 : 28} fallback={nameless} />");
    // Simple mode's chat leaves out the bot's English lines along the way: ChatView reads its rows through this.
    expect(source("src/components/ChatActivity.tsx")).toContain("if (!advanced) return quietChat(messages, pinnedMessageId);");
    expect(source("src/components/ChatView.tsx")).toContain("chatActivityMessages(messages, advanced, activity, bot.pinnedMessageId)");
    // A room's chat too: its transcript and unread line read the same filtered rows.
    const groupView = source("src/components/GroupView.tsx");
    expect(groupView).toContain("const shownMessages = useMemo(() => (advancedMode ? group.messages : quietChat(group.messages, group.pinnedMessageId)), [advancedMode, group.messages, group.pinnedMessageId]);");
    expect(groupView).toContain("    messages: shownMessages,\n    pinOn: [group.busyBotId, group.working, composerDock.pad],");
    expect(groupView).toContain("const unreadDivider = useUnreadDivider({ threadId: group.threadId, messages: shownMessages, following });");
    // An inbox line from a bot's one conversation does not name that conversation.
    const inboxView = source("src/components/inbox/inbox-view.ts");
    expect(inboxView).toContain('row.origin?.title && !isHomeThread(row.origin.threadId) ? t("inbox.in", { title: row.origin.title }) : null');
    expect(inboxView).toContain('return (isHomeThread(row.origin?.threadId) ? undefined : row.origin?.title) ?? t("inbox.subject.message");');
    expect(source("src/suyuan/use-suyuan.ts")).toContain("noteHomes(state.bots);");
    // Simple mode's room header: the name a floating pill in the middle, as in a bot's chat (v1 #70, #71).
    const room = source("src/components/RoomHeader.tsx");
    expect(room).toContain('<div data-roomhead-row className="grid grid-cols-[minmax(var(--suyuan-side,max-content),1fr)_minmax(0,auto)_minmax(var(--suyuan-side,max-content),1fr)] items-center gap-3">');
    expect(room).toContain('<div ref={evenSides} data-roomhead-controls className="flex shrink-0 items-center gap-1.5 justify-self-end">');
    expect(room).toContain('className={cn("group flex min-w-0 max-w-full items-center gap-1 rounded-full px-[13.5px] py-[9.5px]", ELEVATED_FLOAT, ELEVATED_HOVER)}');
    expect(room).toContain('className={cn("flex items-center rounded-full p-[7.5px]", ELEVATED_FLOAT, ELEVATED_HOVER)}');
    // swipe-back.ts finds the room header by these classes to give back the back button's room.
    expect(room).toContain('className="@container/roomhead px-5 py-2.5 pl-11 md:pl-5"');
    // Chinese bold the Markdown rule leaves as stars is made bold after parsing.
    expect(source("src/components/ChatMarkdown.tsx")).toContain("[[remarkGfm, GFM_OPTIONS], remarkMath, remarkCjkStrong, ");
    expect(source("src/components/bot-panel/DetailsTab.tsx")).toContain("{threadsShownNow() && <BotConversations bot={bot} />}");
    expect(source("src/components/routines/ResultsDestination.tsx")).toContain("listedThreads(");
    expect(source("src/lib/bot-unread.ts")).toContain("foreground(bot).tasks");
    expect(source("src/state/thread-navigation.ts")).toContain("foreground(bot).tasks");
  });

  it("keeps the phone's list as he set it: pins beside the chief, newest first, quiet dots, dated times", () => {
    const layout = source("src/lib/sidebar-layout.ts");
    expect(layout).toContain("const listedPins = pinsBesideChief(pinnedBots, unsectionedChief, { searching: options?.searching === true, universalPins });");
    expect(layout).toContain("return { unsectionedChief, pinnedBots: listedPins, sectionChiefs, sectionedBots, unsectionedBots };");
    expect(layout).toContain("const recent = recentBotsFirst(parts);");
    expect(layout).toContain("sectionedBots: recent?.sectionedBots ?? first(parts.sectionedBots), unsectionedBots: recent?.unsectionedBots ?? first(parts.unsectionedBots) };");
    expect(source("src/components/SidebarPhoneHero.tsx")).toContain("if (pins.length > 0) return <HeroTiles chief={bot} pins={pins} onMenu={onMenu} />;");
    // The tiles stand in the hero's place: a tap on the bot already open closes the list, as on upstream's hero.
    expect(source("src/components/Sidebar.tsx")).toContain('event.target.closest("[data-sidebar-bot-row], [data-sidebar-hero]")) onClose();');
    const markers = source("src/components/SidebarRowMarkers.tsx");
    expect(markers).toContain('(activity === "working" || activity === "teammate") && !busyDotShown()');
    expect(markers).toContain('waiting ? "bg-warning" : unreadTone()');
    const tiles = source("src/components/SidebarTiles.tsx");
    expect(tiles).toContain('working ? busyDotShown() ? dot("working-dot", "bg-success")');
    expect(tiles).toContain(': unread ? dot("unread-dot", unreadTone())');
    expect(source("src/components/SidebarBotMenu.tsx")).toContain("() => { onRename(bot.id); announceRename(bot.id); }");
    expect(source("src/suyuan/use-suyuan.ts")).toContain('import "./quiet-rows.css";');
    // The list's times: the build points Sidebar.tsx's calls of the clock at src/suyuan/list-clock.ts.
    expect(source("vite.config.ts")).toContain("sidebarListClock()");
    expect(source("src/components/Sidebar.tsx")).toContain("{formatTime(last.at)}");
  });

  it("keeps the Skill Burger card off until Settings turns it on", () => {
    const slot = source("src/components/skill-burger/SkillBurgerSlot.tsx");
    expect(slot).toContain("const enabled = useSkillBurger();");
    expect(slot).toContain("useRunnable(enabled ? ");
    expect(slot).toContain("if (!enabled || !finished || !runKey || named.has(runKey)) return;");
    expect(slot).toContain("if (!enabled || !finished || !runKey || drafts.has(runKey)) return;");
    expect(slot).toContain("if (!enabled) return null;");
    for (const test of ["SkillBurger", "RunBurger"]) {
      expect(source(`src/components/skill-burger/${test}.dom.test.ts`)).toContain('localStorage.setItem("omb-suyuan-skill-burger", "1")');
    }
  });

  it("keeps the inbox to what waits on the person: read news gone, no Finished section, background runs read with their conversation", () => {
    const panel = source("src/components/inbox/InboxPanel.tsx");
    expect(panel).toContain('import { useUnreadRows } from "@/suyuan/inbox-unread";');
    expect(panel).toContain("const listed = useUnreadRows(view);");
    expect(panel).toContain("const rows = listed.filter((row) => matchesSearch(row, query));");
    expect(panel).not.toContain("<FinishedThreads");
    expect(panel).not.toContain("finishedThreads(");
    // What stays of upstream's panel: the pinned conversations, the active ones, and the Done line at the foot.
    for (const kept of ["<PinnedThreads ", "<InboxActive ", "<section data-inbox-done ", "openInChat(row);"]) expect(panel).toContain(kept);
    const hook = source("src/suyuan/use-suyuan.ts");
    expect(hook).toContain("const loaded = state.hydrated === true;");
    expect(hook).toContain("useInboxCatchUp(inboxCatchUpKey(state), loaded);");
    const place = source("server/host/place-inbox.ts");
    expect(place).toContain("readsWith?(lineThread: string, opened: string): boolean;");
    expect(place).toContain("if (!line.seen && (line.threadId === threadId || deps.readsWith?.(line.threadId, threadId)) && lineFor(auth, line))");
    const index = source("server/index.ts");
    expect(index).toContain('import { readsWith as suyuanReadsWith } from "./suyuan/inbox-read.ts";');
    expect(index).toContain("createPlaceInbox({ dataDir: DATA_DIR, readsWith: (lineThread, opened) => suyuanReadsWith(store, lineThread, opened, (id) => delegatorOf(id)?.threadId ?? null),");
  });

  it("keeps the phone's inbox a page over the bot list, which only a line that opens a conversation closes", () => {
    const row = source("src/components/SidebarInboxRow.tsx");
    expect(row).toContain("const phone = useMediaQuery(PHONE_LAYOUT);");
    expect(row).toContain("else { openInbox(); if (!phone) onOpened?.(); }");
    // Sidebar.tsx is untouched: it still hands the row its close, which the row no longer calls on a phone.
    expect(source("src/components/Sidebar.tsx")).toContain("onOpened={phone ? onClose : undefined} />");
    expect(source("src/hooks/use-bot-list-drawer.ts")).toContain('const KEEPS_LIST_OPEN = "[data-team-side], [data-sidebar-inbox], [data-inbox-panel]";');
    const app = source("src/App.tsx");
    expect(app).toContain('import { useCloseBotDrawer } from "@/suyuan/phone-inbox";');
    expect(app).toContain("useCloseBotDrawer(hideDrawer);");
    const panel = source("src/components/inbox/InboxPanel.tsx");
    expect(panel).toContain('<div data-inbox-page className="fixed inset-0 z-50 flex flex-col bg-app">');
    expect(panel).toContain('className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-app pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">');
    for (const sheet of ["max-h-[85dvh]", "min-h-[50dvh]", "rounded-t-2xl", "bg-black/40"]) expect(panel).not.toContain(sheet);
    expect(panel).toContain("onOpen={(row) => { dispatch(attentionJumpAction(row)); if (phone) leavePhoneInbox(); }}");
    expect(source("src/components/inbox/use-inbox-actions.ts")).toContain("if (phone) leavePhoneInbox();");
    const active = source("src/components/inbox/InboxActive.tsx");
    expect(active).toContain("onOpened={phone ? leavePhoneInbox : closeInbox} />");
    expect(active).toContain("onJump={(entry) => { dispatch(attentionJumpAction(entry)); if (phone) leavePhoneInbox(); }} />");
    expect(source("src/locales/zh.json")).toContain('"inbox.emptyHint": "当机器人需要你确认、向你提问或完成任务时，会显示在这里。"');
  });

  it("loads every CSS overlay from the one frontend hook", () => {
    const hook = source("src/suyuan/use-suyuan.ts");
    for (const sheet of ["chat-wrap", "keyboard-fit", "no-zoom", "phone-code", "phone-tables", "quiet-rows", "quiet-status", "skill-burger", "steady-tables", "wide-replies"]) {
      expect(hook).toContain(`import "./${sheet}.css";`);
    }
    // chat-wrap.css undoes this upstream rule; if upstream drops or rewords it, the overlay needs another look.
    expect(source("src/styles.css")).toMatch(/\[data-chat-bubble="simple"\],\n\.chat-md :is\(p, li, blockquote\) \{\n\s*text-wrap: pretty;/);
    expect(source("src/suyuan/chat-wrap.css")).toMatch(/:root \[data-chat-bubble="simple"\],\n:root \.chat-md :is\(p, li, blockquote\) \{\n\s*text-wrap: wrap;/);
    expect(source("src/suyuan/skill-burger.css")).toMatch(/\.burger-layers > li \{\n\s*flex-shrink: 0;/);
  });

  it("keeps DOM selectors required by retained CSS overlays intact", () => {
    // Tabled replies keep the split layout: prose in ordinary bubbles, each table a card of its own at the top level.
    const reply = source("src/components/ReplyBlocks.tsx");
    expect(reply).not.toContain("data-reply-bubble");
    expect(reply).toContain("data-reply-blocks");
    expect(reply).toContain('<div key={index} data-reply-table className="my-2 w-full max-w-[var(--chat-card-pct)] first:mt-0 last:mb-0">');
    expect(reply).toContain('<div key={index} data-chat-bubble="simple" className={cn("w-fit", SIMPLE_BUBBLE_MAX, SIMPLE_BOT_BUBBLE,');
    expect(source("src/suyuan/wide-replies.css")).not.toContain("data-reply-bubble");
    expect(source("src/suyuan/steady-tables.css")).not.toContain("data-reply-bubble");
    // skill-burger.css moves the jump-to-latest arrow off the card: it finds the arrow by this markup in the chat dock.
    const chat = source("src/components/ChatView.tsx");
    expect(chat).toMatch(/chat-column-dock">\n\s*<SkillBurgerSlot /);
    expect(chat).toMatch(/<div className="relative">\n\s*<JumpToLatestButton onClick=\{jumpToLatest\} className="pointer-events-auto bottom-2" \/>/);
    expect(source("src/components/skill-burger/SkillBurgerSlot.tsx").match(/<div className="flex justify-end px-4 pb-2">/g)).toHaveLength(2);
    for (const card of ["SkillBurger", "RunBurger"]) expect(source(`src/components/skill-burger/${card}.tsx`)).toContain("data-skill-burger=");
    for (const list of ["SkillBurger", "RunBurger", "DraftSteps"]) expect(source(`src/components/skill-burger/${list}.tsx`)).toContain('className="burger-layers flex ');
    expect(source("src/components/RichTable.tsx")).toContain("data-table-card");
    expect(source("src/components/RichTable.tsx")).toContain('className="chat-table"');
    expect(source("src/components/CodeBlock.tsx")).toContain("chat-code-block");
    expect(source("src/components/CodeBlock.tsx")).toContain("data-code-plate");
    expect(source("src/components/MessageActions.tsx")).toContain('data-testid="message-actions"');
    // phone-tiles.css and tile-menu.ts find the tiles, quiet-rows.css the model mark on the list's rows.
    expect(source("src/components/SidebarTiles.tsx")).toContain("data-sidebar-tile");
    expect(source("src/components/Sidebar.tsx")).toContain("data-sidebar-section-id");
    expect(source("src/components/BotModelBadge.tsx")).toContain('data-testid="model-badge"');
    // quiet-status.css draws Simple mode's working line as three dots: it finds the line by these.
    const presence = source("src/components/TurnPresence.tsx");
    expect(presence).toContain('<span className="turn-phrase turn-phrase-quiet relative grid min-w-0" title={hover}');
    expect(presence).toContain("data-turn-status");
    expect(presence).toContain('className={cn("turn-now-chevron", open && "rotate-180")}');
  });
});
