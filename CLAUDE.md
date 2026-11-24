# OpenMausBot · suyuan fork 开发规范

先读 `AGENTS.md`：上游的通用工程约束在这里同样生效。本仓库面向夙愿个人部署使用：服务端运行在办公室 Mac mini 虚拟机 `lizhi-vm` 上，日常通过网页 / iPhone Safari PWA（`https://bot.tokenic.cn`）访问。线上版本、bot 分布与虚拟机主开关以 `node scripts/suyuan/status.mjs` 现查为准，保留能力与退场记录见 [`FORK.md`](./FORK.md)。

## 分支与同步

- `suyuan`：线上部署分支；发版与线上维护以它为准。
- `suyuan-v2`：基于 `upstream/main` 整理出的清洁薄分叉基线（当前上游底座版本见 `status.mjs`）。
- `upstream/main`：上游仓库 `milind-soni/OpenMausBot`。平时仅在需要时手工合入上游更新，不用自动同步流。

**增量隔离原则（重要）：**
1. 自建代码统一放在 `server/suyuan/`、`shared/suyuan/`、`src/suyuan/`、`scripts/suyuan/` 与 `public/suyuan-push-sw.js`。
2. 尽量少改上游文件，尤其**不要修改** `src/components/Sidebar.tsx` 和 `src/components/ChatView.tsx`，保留上游布局迭代能力。
3. 每处接入上游的 hook 都在 `server/suyuan/wiring.test.ts` 中写断言钉住，防止后续合并悄然丢失。
4. 严格遵守 `scripts/testing/file-size-ratchet.test.ts` 的文件行数上限（具体数值以该测试为准；改 `server/index.ts` 等大文件尽量同行收口或下沉 `server/suyuan/`，其余源码文件保持在 1000 行内）。

## 验证与构建流程

提交前至少完成以下检查：

```bash
pnpm typecheck && bash scripts/suyuan/ci-typecheck.sh && pnpm lint
```

运行全部 `suyuan` 用例、文件尺寸与接线守卫，以及被改动到的上游模块测试：

```bash
pnpm exec vitest run \
  scripts/suyuan/deploy-vm-remote.suyuan.test.ts \
  scripts/testing/file-size-ratchet.test.ts \
  scripts/testing/index-route-ratchet.test.ts \
  scripts/testing/web-app-assets.test.ts \
  server/activity.test.ts \
  server/automation-reports.test.ts \
  server/automation-reports.e2e.test.ts \
  server/config.test.ts \
  server/drivers/acp/client-path.test.ts \
  server/drivers/agents-bridge-wire.test.ts \
  server/drivers/agents-catalog-wire.test.ts \
  server/drivers/antigravity.test.ts \
  server/host/person-stop.test.ts \
  server/room-holds.test.ts \
  server/routes/internal-threads.test.ts \
  server/routes/threads-*.test.ts \
  server/suyuan/*.test.ts \
  server/tool-schema-profile.test.ts \
  server/update-check.suyuan.test.ts \
  server/update-check.test.ts \
  shared/suyuan/*.test.ts \
  src/components/ChatMoreMenu.test.ts \
  src/components/ChatView.controls.test.ts \
  src/components/ChatView.voice.test.ts \
  src/components/Composer.*.test.ts \
  src/components/RoomMoreMenu.test.ts \
  src/components/bot-panel/DetailsTab.test.ts \
  src/components/routines/ResultsDestination.test.ts \
  src/hooks/use-unread-divider*.test.ts \
  src/lib/bot-unread.test.ts \
  src/lib/notify*.test.ts \
  src/state/thread-navigation.test.ts \
  src/suyuan/*.test.ts
```

打包命令：

```bash
pnpm build && pnpm build:server
```

如需打 npm 离线包（用于虚拟机隔离演练或发版）：

```bash
node scripts/build-npm-package.mjs && (cd release/npm && npm pack)
```

## 隔离验证与部署纪律

- **严禁在验证阶段碰生产环境**：`lizhi-vm:8799`、虚拟机 `~/.openmausbot`、公网 `bot.tokenic.cn` 只承载真实服务。隔离联调必须用 `scripts/control-omb.ts`、`scripts/suyuan/phone-test.sh`，或独立的 `--data-dir` + 高端口（如 `18900`）数据副本，且演练副本不得开启定时任务与真实 Web Push 订阅，验证完彻底清理进程与 `/tmp` 临时目录。
- **线上部署**：在 MacBook 跑 `scripts/suyuan/deploy-vm.sh`（经 MacBook 下载 release 再传到虚拟机安装；有 bot 忙碌会自动排队等空闲；异常自动回滚 `--rollback`）。在虚拟机内由「Maus 工程师」触发时用 `scripts/suyuan/deploy-self.sh`。
- **切忌在文档或日志里输出任何密钥、API Key、Webhook Token 或订阅凭证。**

## 接手与收尾

- 接手前先跑 `node scripts/suyuan/status.mjs`（离线加 `--offline`）看实时现状，再读 [`FORK.md`](./FORK.md)。线上版本、bot 模型分布和虚拟机开关不手工抄进文档，全部以现查为准。
- 收尾一个对话时，按 `FORK.md` 顶部的维护规则更新对应小节（小改动加 1 短行、超 3 条规则或跨 3 个以上模块的大特性拆到 `docs/suyuan/<主题>.md` 并挂索引、退场改动留一行墓碑、短周期项用 `[YYYY-MM-DD]` 标日期并做完即删），再跑一次 `node scripts/suyuan/status.mjs` 顺手清掉挂超两周的旧条目，和代码同一次提交。`FORK.md` 关键小节与防膨胀上限由 `server/suyuan/fork-doc.suyuan.test.ts` 守卫。

## 在做中学 Harness 基本功（局部例外）

本仓库改代码、修 bug、合上游或调架构时，在简短汇报结果之后，额外用 3–5 句大白话讲透本次真实碰到的 **1 个 Harness 基本功**（覆盖全局「完成后汇报简短、不讲技术细节」的限制）：
- 只讲**设计思路与取舍**（为什么要这样分层或设边界、同样的问题 Claude Code / Codex / OpenCode 等常见做法怎么取舍、哪点能反哺 `firstmate` 或个人系统），不堆文件名和代码行细节。
- 每次只挑当天改动里最值钱的 1 个点讲透；纯机械改字或没碰到设计取舍的小修直接略过，不硬凑。
