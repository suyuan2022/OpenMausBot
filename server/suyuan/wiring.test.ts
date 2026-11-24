// suyuan fork: fast, source-level wiring checks ensuring every retained thin-fork hook stays connected to upstream files.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("suyuan-v2 thin-fork wiring", () => {
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
    expect(source("src/main.tsx")).not.toContain("last-frame");
    expect(source("src/lib/notify.ts")).toContain("if (pushHandlesNotifications() && !frame.forPerson) return;");
    expect(source("src/components/NotificationSettingsRows.tsx")).toContain("<WebPushRow />");
    expect(source("src/components/settings/pages/AppPages.tsx")).toContain("<VoiceButtonRow />");
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
    expect(source("src/components/bot-panel/DetailsTab.tsx")).toContain("{threadsShownNow() && <BotConversations bot={bot} />}");
    expect(source("src/components/routines/ResultsDestination.tsx")).toContain("listedThreads(");
    expect(source("src/lib/bot-unread.ts")).toContain("foreground(bot).tasks");
    expect(source("src/state/thread-navigation.ts")).toContain("foreground(bot).tasks");
  });

  it("keeps DOM selectors required by retained CSS overlays intact", () => {
    expect(source("src/components/ReplyBlocks.tsx")).toContain("data-reply-bubble");
    expect(source("src/components/ReplyBlocks.tsx")).toContain("data-reply-table");
    expect(source("src/components/RichTable.tsx")).toContain("data-table-card");
    expect(source("src/components/RichTable.tsx")).toContain('className="chat-table"');
    expect(source("src/components/CodeBlock.tsx")).toContain("chat-code-block");
    expect(source("src/components/CodeBlock.tsx")).toContain("data-code-plate");
    expect(source("src/components/MessageActions.tsx")).toContain('data-testid="message-actions"');
  });
});
