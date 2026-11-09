# OpenMausBot · suyuan fork

先读 `AGENTS.md`：原作者的规矩在这里照样适用。这个 fork 只给夙愿一个人用，服务端跑在他办公室 Mac mini 的虚拟机 `lizhi-vm` 上，手机和桌面端都连 `https://bot.tokenic.cn`。相对原作者多了哪些改动、还有哪些待做，看 `FORK.md`。

## 分支

- `suyuan`：部署分支，也是默认分支。每个改动从它拉 `fix/<名字>` 或 `feat/<名字>`，开 PR 合回 `suyuan`。改动要叠在另一个还没合并的改动上时，从那个分支拉，PR 的 base 设成它；合并时从最上层往下合，最后把最底下那个合进 `suyuan`。
- `upstream/main`：原作者的代码（remote `upstream` 指向 milind-soni/OpenMausBot）。夙愿要原作者的更新时手动合：从 `suyuan` 拉 `sync/upstream-<日期>`，`git merge upstream/main`，开 PR，CI 绿了合并、部署。每天自动同步的流程 `.github/workflows/suyuan-sync.yml` 已停用。
- 别的用户也会碰到的修复，另从 `upstream/main` 拉分支，把提交挑过去，给原作者开 PR。原作者收下后，在 `FORK.md` 把那一行标成「已还」。

改动一律做**加法**：新功能放新文件，原作者的文件只加接入用的几行。改动越少，合并原作者更新时越少冲突。

## 一个改动怎么走

质量按夙愿实际的用法衡量：iPhone 主屏幕网页 App、简洁模式、电脑浏览器。在这些用法下把事做对、量清楚；用不到的场景不加代码、测试和说明。

1. **写代码。** 服务端逻辑、数据结构、接口的改动都带 vitest 用例：合并原作者的更新时，只有这些用例能发现我们的改动被弄坏了。只改样式和文案的不用写，靠第 2 步量出来的数字。用例放在新文件 `<被测文件>.suyuan.test.ts`，原作者的测试文件只改被我们改坏的断言。接进原作者文件的那几行，在 `server/suyuan/wiring.test.ts` 加一条断言钉住。
   完成：相关用例是绿的，`pnpm typecheck` 和 `pnpm lint` 都过。
2. **在隔离实例上验。** 照 `docs/verification/README.md` 的「Launch」一节起一个隔离实例（临时数据目录，接假模型），用 lcu 在 Chrome 里打开它打印出来的地址，把改动涉及的每个界面状态都点一遍、截图。推送、通知这类 Chrome 能测的，先在 Chrome 里测。验证只用隔离实例：虚拟机上的 8799 端口和 `bot.tokenic.cn` 是夙愿正在用的 bot。
   几个不好查的做法：
   - 假模型的回复用环境变量 `FAKE_CLAUDE_REPLIES`（JSON 字符串数组，按顺序一条条回）和 `FAKE_CLAUDE_REPLY_STATE`（记到第几条的文件）指定，用来造带表格、长段落的回复。
   - `scripts/control-omb.ts` 的帮助里有发消息、建 bot、建群的命令。往同一个对话里连发，要带上第一次 `run` 返回的 `--task`，不然每条都开一个新对话。
   - 隔离实例第一次打开会弹几层新手引导，先点掉。
   - 模拟手机要用 CDP 同时设 `Emulation.setDeviceMetricsOverride`（402×874）和 `Emulation.setTouchEmulationEnabled`，只设屏幕尺寸的话 `(hover: none)` 不成立，只在触屏上生效的样式看不到。
   修 bug 先复现：照夙愿描述的现象，在隔离实例里造出同样的条件（屏幕宽度、对话内容、操作），把现象量成数字或录下来，对上了再动手；修完在同样条件下再量一次。复现不出来，回去问清楚现象。
   完成：修 bug 的，修前量得到现象、修后量不到；每个改到的界面状态都有截图，和预期一致。
3. **交夙愿在手机上确认。** 改动里有只能在手机上判断的部分（真机推送、主屏幕网页 App 的手感、iPhone Safari 上的渲染），开 PR 之前先装一个测试版给他试：`scripts/suyuan/pack-test.sh` 把当前工作区打成测试版安装包并打印路径，`scripts/suyuan/deploy-vm.sh <那个路径>` 装到虚拟机。测试项只列手机上才能判断的，写清测什么、在哪测、看到什么算对；Chrome 里能测的第 2 步已经测完。没有这类部分就跳过这步；改到数据格式或数据迁移的也不装测试版，因为换回正式版只换程序、不换回数据。
   完成：夙愿说手机上没问题。他说有问题，或者这个改动不做了，先跑不带参数的 `scripts/suyuan/deploy-vm.sh` 装回最新正式版，再回第 1 步。
4. **开 PR 合到 `suyuan`。** 正文写短：为什么改、改了什么、怎么验证的（量到的数字、夙愿确认了什么），各几行。
   完成：`FORK.md` 的改动清单加了这一行。
5. **独立审查一次。** 起一个没看过这次对话的 agent，只给它 PR 号和这次改动的目的：
   `env -u CLAUDECODE claude -p "<审查任务>" --model opus --effort xhigh --allowedTools "Read,Grep,Glob,Bash(git:*),Bash(gh pr view:*),Bash(gh pr diff:*)"`
   任务里写明：只报夙愿实际用法下会出的问题，按影响排，最多 5 条。只改文案或几行样式的不用审。
   它提的意见由你判断改不改。改动大的，再让它审一次改过的部分，到此为止。照意见改到了手机上才能判断的部分，回第 3 步再装一次测试版。
6. **CI 绿了就合并。** 用 Bash 后台跑 `gh pr checks <PR 号> --watch`，结束了再看结果，不在对话里反复查。下载 Electron 这类网络错误导致的失败，用 `gh run rerun <run id> --failed` 重跑一次。合并会触发自动流程 `.github/workflows/suyuan-release.yml`，打出名为 `suyuan-v<版本>` 的 release，附 npm 安装包。
7. **部署。** 在 MacBook 的这个仓库里跑 `scripts/suyuan/deploy-vm.sh`：用 gh 下载最新 release，拷到虚拟机，由 `deploy-vm-remote.sh` 装上并重启服务（虚拟机访问 GitHub 时通时断，所以由 MacBook 中转）。第 3 步装过的测试版由这个正式版换掉。脚本不会打断干活的 bot：有 bot 在忙就先等，最多等 10 分钟，等不到就什么都不装、直接退出。已经在跑这个版本时什么也不做。出问题就用 `--rollback` 换回上一个正式版（测试版不算上一版）。

## 虚拟机

- `ssh lizhi-vm` 登录。服务由 LaunchAgent `com.openmausbot.serve` 管，数据在 `~/.openmausbot`。那是夙愿的真实数据，只读着看。
- 升级只走 `deploy-vm.sh`。`npm install -g openmausbot` 会把 fork 换回官方版。
- `deploy-vm.sh` 最长要跑十几分钟，`pack-test.sh` 也要几分钟，都用 Bash 的后台运行或把超时调到 15 分钟。部署断线不影响部署本身，日志在虚拟机的 `~/.openmausbot-releases/deploy.log`。
- 公网入口 `bot.tokenic.cn` 是北京服务器（`ssh root@82.157.117.245`）上的 nginx，配置在 `/etc/nginx/sites-available/bot.tokenic.cn`，经虚拟机打过来的 ssh 反向隧道转到虚拟机的 8799。这台服务器出口只有约 3 Mbps，是手机打开慢的瓶颈，所以 nginx 对脚本和接口数据开了 gzip。这台服务器上还跑着别的站点，改配置前先备份，`nginx -t` 通过再 `systemctl reload nginx`。

## 在虚拟机上干活（Maus 工程师）

bot「Maus 工程师」跑在 `lizhi-vm` 的 OpenMausBot 服务里，仓库在虚拟机的 `~/Documents/OpenMausBot`，夙愿在手机上给它派活。上面的流程照走，不同的只有这几处：

- 上面写「在 MacBook 上跑」「`ssh lizhi-vm`」的，在这里直接在本机跑。
- 装测试版、部署正式版都用 `scripts/suyuan/deploy-self.sh`，参数和 `deploy-vm.sh` 一样，只是没有 `--force`。重启服务会把你自己也重启，所以它在后台等所有 bot 都空闲才装，你自己也算在内：它一跑完，你就告诉夙愿「在等空闲，装完会重启」，然后结束这一轮。服务重启后夙愿再找你时，先读 `~/.openmausbot-releases/deploy.log` 的末尾，确认装上了。
- 装测试版、部署正式版会重启夙愿正在用的服务，合并 PR 会改动部署分支 `suyuan`：这三件事每次都要他在当次对话里明确同意。
- 这台机器上同时跑着夙愿的真实 bot。隔离实例只用 `scripts/control-omb.ts launch` 起的临时实例，不碰 8799 端口。Chrome 和 lcu 也是共用的：测试时用 lcu 新开标签页，测完关掉自己开的，别的标签页不碰。跑全量测试、打包这类吃 CPU 的活之前看一眼 `uptime`，负载高就等一等。
- 虚拟机连 GitHub 时通时断：`gh`、`git push` 失败就隔几分钟再试，试几次还不行就告诉夙愿。
- 夙愿在手机上读你的回复：结论放最前面，写短。PR 和文档动笔前读 `~/.claude/guides/写给谁看.md`。
