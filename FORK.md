# OpenMausBot · suyuan-v2 分叉说明与状态

> **接手先跑**：`node scripts/suyuan/status.mjs`（离线加 `--offline`）。线上版本、bot 模型分布、虚拟机主开关、远端分支、工作区脏状态与最近提交均由脚本现查，**本文件不抄动态数字**。
>
> **长期维护与扩容规则（防膨胀、防过时）**：
> 1. **小改写一行，大改拆文档**：普通改动在「保留的能力」加 1 短行（写清“为什么留 + 上游去向”，单行不超过 260 字）；涉及超过 3 条规则或跨 3 个以上模块的大特性，规格拆到 `docs/suyuan/<主题>.md`，表格「主要位置」列只放该文档链接。
> 2. **短命项带日期，长周期不催办**：只有「等夙愿真机确认」「近期要做」每条必须用 `[YYYY-MM-DD]` 标日期（超 14 天、缺日期或日期无效由 `status.mjs` 提醒）；其余长期小节只统计条数，不催办。
> 3. **退场留一行墓碑**：交还上游或刻意删掉的能力，从「保留的能力」挪进「已定论与退场记录」留一句原因，防后续重造。
> 4. **跨处分工**：日常使用现象、夜巡自动发现的 bug 与生效追踪全放 `~/suyuanos/04 进化实验室/dogfood/OpenMausBot.md`；本页只管仓库改动索引、红线、上线待验与拍板结论；`~/Documents/omb-wt/待办.md` 已于 2026-11-13 停用归档。

## 保留的能力

自建代码隔离在 `server/suyuan/`、`shared/suyuan/`、`src/suyuan/`、`scripts/suyuan/` 与 `public/suyuan-push-sw.js`，所有上游接入点由 `server/suyuan/wiring.test.ts` 守卫。开发与隔离验证纪律见 [`CLAUDE.md`](./CLAUDE.md)。

| 模块 | 为什么留（解决什么问题） | 主要位置 | 上游去向 |
|---|---|---|---|
| 分叉运维、守卫与更新源 | 增量 CI、自动发包、零中断部署、隔离真机测试；更新检测指本 fork | `.github/workflows/suyuan-*.yml`、`scripts/suyuan/`、`wiring.test.ts`、`update-check.ts` | 仅自用 |
| 自建网页推送（Web Push） | 闭源 iOS App 无法自托管推送；Safari PWA 收通知，撤销设备时退订 | `public/suyuan-push-sw.js`、`server/suyuan/web-push*.ts`、`src/suyuan/*web-push*` | 可问上游 |
| 关闭投机预总结 | 默认 `OMB_WARM_SUMMARY=0`，防抢跑折叠丢上下文，其余交上游原生 | `server/suyuan/register.ts` | 仅自用 |
| ACP 额外目录穿透 | 让 Antigravity 等非 Claude 引擎读工作区与共用技能并隔离会话键 | `server/suyuan/acp-extra-dirs.ts` | 候选提 PR |
| 附件缓存与接入小修 | 图片长缓存省带宽；Codex 别名；`screenMcpServers` 防钉浏览器；热重载 | `server/suyuan/attachment-cache.ts`、`codex-official-alias.ts`、`screen-mcp.ts`、`config-reload*.ts` | 缓存候选提 PR |
| 自动化汇报与触发增强 | 定时/派活首轮立即汇报与恢复；纯文本免模型提醒、`check_first`、`run_with` | `server/suyuan/automation-report-turns.ts`、`plain-reminder.ts`、`check-first.ts`、`run-with.ts` | 仅自用 |
| 停轮、中文喊停与切模型 | 喊停不连坐队友；中文停手口令防抢答；派活单次指定 `model_selection` | `server/suyuan/stop-turn-only.ts`、`chinese-stop.ts`、`handoff-model.ts` | 仅自用 |
| Chief 只读队友对话 | Chief（荔枝）用 `team_threads` / `team_thread_read` 只读队友进展 | `server/suyuan/chief-read-*.ts`、`thread-facts.ts` | 仅自用 |
| 瘦身版「一个 bot 一个家」 | 保持 1 bot 1 家门面与未读逻辑，且零改动 `Sidebar.tsx` / `ChatView.tsx` | `server/suyuan/home.ts`、`src/suyuan/home.ts` | 仅自用 |
| 精简收件箱（Inbox） | 只留待处理与未读、后台任务随主对话已读、手机整屏独立页、补中文空态 | `src/suyuan/inbox-unread.ts`、`server/suyuan/inbox-read.ts`、`src/suyuan/phone-inbox.ts` | 仅自用 |
| 手机排版与表格稳定 | 宽排气泡、表格稳定与独立整宽卡片、防撑宽、未读分割线即时标记 | `src/suyuan/wide-replies.css`、`steady-tables.css`、`table-plate.ts`、`divider-seen.ts` | `steady-tables` 候选提 PR |
| 手机手势与控件开关 | 键盘贴合、右滑返回、禁整页缩放、默认隐藏语音钮与任务步骤卡片（可开） | `src/suyuan/keyboard-fit.*`、`swipe-back.ts`、`no-zoom.*`、`voice-button.ts`、`skill-burger.*` | 仅自用 |

## 硬红线与仓库外依赖

- **代码与验证红线**：**绝不改动** `src/components/Sidebar.tsx` 与 `src/components/ChatView.tsx`；严禁验证时碰生产 `lizhi-vm:8799` 与 `~/.openmausbot`；严禁在文档或日志输出密钥/token。
- **回滚不动的仓库外依赖与迁移**（`deploy-vm.sh --rollback` 只换程序不动配置；旧版回退包 `0.1.149-suyuan.65` 与 `suyuan-v1-archive` 作兜底；新增一次性迁移或补丁按“日期 + 位置 + 目的 + 备份/版本”追加）：
  - **2026-11-13，Claude 会话保留**：虚拟机 `~/.claude/settings.json` 设 `cleanupPeriodDays: 3650`（防默认 30 天删旧会话影响回搜原文；备份 `settings.json.bak-20261113-keep-sessions`）。
  - **2026-11-24，`lcu` 非 Claude 补丁**：虚拟机 `~/.local/share/lcu/current/adapters/claude.mjs`（当前 `lcu 0.13.5-7d17e28f4418`）打了 `fallbackNonClaudeContext`，供 Antigravity 调 `lcu`；升级 `lcu` 时复核。
  - **2026-11-24，群聊路由迁入原生配置**：原 `suyuan-room-router.json` 参数已迁入 `config.json` 的 `decider`（备份 `config.json.bak-20261124-suyuan-v2`）。

## 上游同步与跳过清单

- **同步节奏**：每 1–2 周手工合一次 `upstream/main`（底座版本与同步日期见 `status.mjs`）。
- **待定给上游提 PR 的通用修复**：`acp-extra-dirs`、`steady-tables.css`、`attachment-cache`（开不开由夙愿定）。
- **合上游时明确跳过 / 不拿的项**（决定跳过某条上游改动时，记清特征与原因，防下次误合）：
  - **聊天内展示压缩过程卡片**（如旧上游 `a5cf727f6` 类改动）：夙愿不要在聊天流里看到压缩过程提示卡片。

## 等夙愿真机确认

- `[2026-11-24]` **`.68` 手机整屏收件箱**：点收件箱盖住整屏、关掉回 bot 列表，只有点条目才进对话；上线后待确认手感。
- `[2026-11-24]` **删掉假首屏后的首屏速度**：`last-frame` 已移除，待手机实测上游首屏是否够快，慢了再考虑轻骨架屏。
- `[2026-11-24]` **上游原生列表排序与首页**：旧版“按最新消息排 + 头像方块”未搬，先试用几天再定。
- `[2026-11-24]` **iPhone 带表格对话是否仍卡顿**：`.67` 已恢复表格整宽卡片，待真机确认。

## 近期要做

- `[2026-11-24]` **清理两条废弃远端分支**：`origin/fix/sync-retry-flaky`、`origin/feat/routine-one-thread`（删前问夙愿）。
- `[2026-11-24]` **清理虚拟机残留旧路由文件**：`~/.openmausbot/suyuan-room-router.json` 已不再读取，确认后可删。

## 碰到再说与长期专题

- **聊天流待买/待办卡片体验**：已在 T3 线程「OpenMausBot 交互与待办体验优化」待聊；定稿后若跨模块则拆到 `docs/suyuan/`。
- **记忆写入分层（未设计）**：bot 学到的偏好目前一律写进 `aboutMe`，规矩类如何分流到 `everyBotRules` 待设计。
- **部署失败自动回滚真机演练**：目前只用假命令测过，后续有隔离演练窗口时补一次。
- **日常低频现象观察**：跨 bot 记忆不同步、排队文案、非 Claude 的 `run_with: haiku` 等现象统一归口 `~/suyuanos/04 进化实验室/dogfood/OpenMausBot.md`，碰到升级到线再进本页「近期要做」。

## 已定论与退场记录

- **不做改名对外分发（2026-11-24 定调）**：T3 线程「老板个人助理私教定位与方案评估」已给出结论——不走删 `enterprise/` 改名对外维护发行版，本改造版只自用与演示；私教走定制服务。
- **Antigravity 中途发消息进队列（2026-11-19 定维持现状）**：谷歌 ACP 桥未暴露中途插话接口，等上游补接口再看。
- **v2 退场 — 群聊路由与自建压缩栈**：`room-router`（改用原生 `decider`）、`steady-prompt` / `native-compact` / `compact-volatile`（改用原生压缩 + `OMB_WARM_SUMMARY=0`）。
- **v2 退场 — 重度界面与消息流魔改**：`Sidebar.tsx` / `ChatView.tsx` 补丁、`SidebarTiles`、`last-frame`、`quiet-*`、`tray-at-finger`、`relay`、`BackgroundRunBar`、`PassedOnFrom`、`PhoneInboxButton`。
- **v2 退场 — 后台与收件箱重补丁**：`recent-work`、`waiting-on`、`self-thread`、`relay-gate`、`idle-archive`（收件箱只保留轻量的已读离开与整屏页）。
