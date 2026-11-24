# OpenMausBot · suyuan-v2 分叉说明

`suyuan2022/OpenMausBot` 是 [milind-soni/OpenMausBot](https://github.com/milind-soni/OpenMausBot) 的个人 fork，只服务于夙愿自己的环境（办公室虚拟机 `lizhi-vm` 与公网入口 `bot.tokenic.cn`）。

`suyuan-v2` 基于上游 `upstream/main`（`v0.1.178`，`36e9f4b8f`）重构为「薄分叉（thin fork）」：保留真正不可替代的十余项高价值能力，把与上游冲突高、或上游已做得更好的界面与路由能力彻底交还上游。开发和验证约定见 [`CLAUDE.md`](./CLAUDE.md)。

## 保留的能力清单

| 模块 | 解决什么问题 | 改动位置 | 状态 / 说明 |
|---|---|---|---|
| 分叉运维与接线护栏 | 增量类型检查、三线 CI、自动发包、零中断虚拟机部署与隔离真机测试；每处上游接入点有源码断言守卫 | `.github/workflows/suyuan-*.yml`、`.github/actions/suyuan-setup/`、`scripts/suyuan/`、`FORK.md`、`CLAUDE.md`、`server/suyuan/wiring.test.ts` | 仅自用 |
| 更新检测指向本 fork | 不误提示用官方包覆盖本地 fork | `server/update-check.ts`、`server/update-check.test.ts`、`server/update-check.suyuan.test.ts` | 仅自用 |
| 自建网页推送（Web Push） | 苹果 App 未自带自建服务器推送；Safari PWA 收完结/提问/审批通知，点击直达对应对话，设备撤销登录时一并退订清理 | `public/suyuan-push-sw.js`、`server/suyuan/web-push*.ts`、`src/suyuan/web-push.ts`、`src/suyuan/use-web-push.ts`、`src/suyuan/WebPushRow.tsx`；接入 `server/index.ts`、`src/App.tsx`、`src/lib/notify.ts`、`src/components/NotificationSettingsRows.tsx` | v2 已补齐 `sessions.onSessionRevoked` 退订清理 |
| 关闭投机预总结（`OMB_WARM_SUMMARY=0`） | 防止服务端在未达线前抢跑折叠导致长对话丢失上下文，同时直接复用上游原生压缩机制 | `server/suyuan/register.ts`（`OMB_WARM_SUMMARY ??= "0"`），接入 `server/index.ts`、`server/drivers/claude.ts` | 替代旧自建压缩栈 |
| ACP 额外目录穿透 | 为 Antigravity 等 ACP 引擎传递并放行 bot 的 `additionalDirectories`，同时隔离会话键 | `server/suyuan/acp-extra-dirs.ts`，接入 `server/drivers/acp/core.ts`、`client-file-request.ts`、`turn-state.ts` | v2 新增并补全 |
| 附件强缓存、Codex 别名、屏幕 MCP 与配置热重载 | 图片长缓存减低北京中转带宽压力；Codex 官方别名兼容；配置 `screenMcpServers` 防自动钉住浏览器并统一提示文案；改 `config.json` 热生效 | `server/suyuan/attachment-cache.ts`、`codex-official-alias.ts`、`screen-mcp.ts`、`config-reload*.ts`；接入 `server/config.ts`、`routes/threads.ts`、`drivers/codex*.ts`、`server/index.ts` | — |
| 自动化首轮立即汇报与未竟恢复 | 定时/委托任务在第一轮结果出来时立即汇报，中断重连后可恢复待汇报轮次 | `server/suyuan/automation-report-turns.ts`，接入 `server/automation-reports.ts` | 已适配 `0.1.178` 汇报流程 |
| 纯文本直达提醒与触发器增强 | 轻量提醒直接文本投递不走完整长链；定时任务支持先检查再执行（`check_first`）及指定执行对象（`run_with`） | `server/suyuan/plain-reminder.ts`、`check-first.ts`、`run-with.ts`、`shared/suyuan/`、`src/suyuan/run-with.ts`、`src/suyuan/RunWithSelect.tsx`；接入 `RoutineCalendarPage.tsx`、`packages/phone-protocol/`、`server/drivers/agents-*`、`server/index.ts` | — |
| 只停当前轮与中文口头喊停 | 人喊停时优先只停当前轮而不是连坐整组；识别中文停手口令防止群聊继续抢答 | `server/suyuan/stop-turn-only.ts`、`chinese-stop.ts`；接入 `person-stop.ts`、`runtime.ts`、`runtime-coordinator.ts`、`room-holds.ts`、`server/index.ts` | — |
| 派活临时切换模型 | `coordinate_bots` 支持单次派活传 `model_selection`，并在忙时拒绝跨模型覆盖 | `server/suyuan/handoff-model.ts`；接入 `agents-catalog.ts`、`agents-call.ts`、`server/index.ts` | — |
| Chief 只读队友对话与工具说明微调 | Chief（如荔枝）可用 `team_threads` / `team_thread_read` 只读看队友 1:1 进展；对齐线程行为事实 | `server/suyuan/chief-read-threads.ts`、`chief-read-tools.ts`、`chief-read-view.ts`、`thread-facts.ts`；接入 `routes/internal-threads.ts`、`agents-catalog.ts`、`agents-call.ts`、`system-prompt.ts`、`src/locales/` | — |
| 瘦身版「一个 bot 一个家」 | 保持 1 bot 1 家门面的简洁菜单/未读提示/守护规则，同时**零改动** `Sidebar.tsx` 与 `ChatView.tsx`，完整吃进上游布局升级 | `server/suyuan/home.ts`、`src/suyuan/home.ts`；接入 `work-thread.ts`、`internal-threads.ts`、`ChatMoreMenu.tsx`、`RoomMoreMenu.tsx`、`SidebarBotMenu.tsx`、`DetailsTab.tsx`、`ResultsDestination.tsx`、`bot-unread.ts`、`thread-navigation.ts` | 保留 `side === "team"` 团队边界 |
| 精简收件箱（Inbox） | 收件箱主列表只留「等你处理的」和「还没读的」：读过的消息下次打开就不再占位（当次打开期间点开的那条先留着，方便顺着往下读）；在 bot 的主对话里读过，后台任务（派活、定时任务）汇报上来的那几条也一并算已读；不显示「最近已读的对话」区块，置顶对话、进行中的对话和底部「已完成」折叠区照旧。手机上收件箱是盖住整屏的一页（不再是露出半截对话的底部弹窗）：从 bot 列表点开时列表不收起，关掉收件箱就回到列表；只有在收件箱里点具体条目进对话时，收件箱和 bot 列表才一起收起；补上空收件箱提示语的简体中文 | `src/suyuan/inbox-unread.ts`、`server/suyuan/inbox-read.ts`、`src/suyuan/phone-inbox.ts`；接入 `src/components/inbox/InboxPanel.tsx`（`useUnreadRows`，不渲染 `<FinishedThreads>`，手机整屏 `data-inbox-page`）、`src/suyuan/use-suyuan.ts`（`useInboxCatchUp`）、`server/host/place-inbox.ts`（`deps.readsWith`）、`server/index.ts`（`suyuanReadsWith`）、`src/components/SidebarInboxRow.tsx`、`src/hooks/use-bot-list-drawer.ts`、`src/App.tsx`（`useCloseBotDrawer`）、`src/components/inbox/use-inbox-actions.ts`、`src/components/inbox/InboxActive.tsx`、`src/locales/zh.json`（`inbox.emptyHint`） | 从 v1 恢复的精简版；`FinishedThreads.tsx` 及其测试保留不删，只是面板不再引用；`Sidebar.tsx` 不动，它传给收件箱那一行的「收起列表」在手机上不再被调用 |
| 轻量移动端与 PWA 体验层 | 气泡宽排与表格不乱跳（带表格的回复保持旧版拆分排版：文字在普通气泡里，每张表格独立成整宽卡片）、气泡内文字换行铺满不留右侧空白、代码块防撑宽、表格外框；打字时隐藏停止、默认隐藏语音圆钮（设置可开）、默认隐藏任务步骤卡片 Skill Burger（设置可开，并修步骤被压扁、回到底部按钮压住卡片）、未读分割线即时标记、键盘贴合、右滑返回、禁整页双击/双指缩放、图片预览双指缩放、状态栏主题色 | `src/suyuan/use-suyuan.ts`、`wide-replies.css`、`steady-tables.css`、`phone-tables.css`、`phone-code.css`、`table-plate.ts`、`chat-wrap.css`、`voice-button.ts`、`VoiceButtonRow.tsx`、`skill-burger.ts`、`SkillBurgerRow.tsx`、`skill-burger.css`、`divider-seen.ts`、`keyboard-fit.*`、`swipe-back.ts`、`no-zoom.*`、`preview-zoom.ts`、`theme-color.ts`；接入 `Composer.tsx`、`AppPages.tsx`、`ReplyBlocks.tsx`、`skill-burger/SkillBurgerSlot.tsx`、`use-unread-divider.ts`、`main.tsx`、`App.tsx` | 不再改动 `Sidebar.tsx` / `ChatView.tsx` |

## 在 v2 中退场 / 交还上游的部分

以下旧改在 `v0.1.178` 已由上游原生解决或收益不再值得背负维护成本，已在 `suyuan-v2` 清理移除：

- **`room-router`**：上游已原生支持 `decider.provider = "custom"` + `customApi = "chat"`。切到 v2 正式部署时，将生产 `~/.openmausbot/suyuan-room-router.json` 迁入 `config.json` 的 `decider` 字段即可。
- **自建压缩与固定前缀补丁**：移除 `steady-prompt`、`native-compact`、`compact-volatile`，统一交由上游 `0.1.178` 压缩与 `OMB_WARM_SUMMARY=0` 处理。
- **重度界面与消息流魔改**：移除 `Sidebar.tsx` / `SidebarTiles` / `ChatView.tsx` 补丁、`last-frame`、`quiet-*`、`tray-at-finger`、`relay`、`BackgroundRunBar`、`PassedOnFrom`、`PhoneInboxButton`、`recent-work`、`waiting-on`（收件箱「在等谁」提示）、`self-thread`、`relay-gate`、`idle-archive`。收件箱的 `inbox-read` / `inbox-unread` 两个轻量 hook 已恢复，见上表「精简收件箱」。
