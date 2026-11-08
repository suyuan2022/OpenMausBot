# OpenMausBot · suyuan fork

先读 `AGENTS.md`：原作者的规矩在这里照样适用。这个 fork 只给夙愿一个人用，服务端跑在他办公室 Mac mini 的虚拟机 `lizhi-vm` 上，手机和桌面端都连 `https://bot.tokenic.cn`。相对原作者多了哪些改动、还有哪些待做，看 `FORK.md`。

## 分支

- `suyuan`：部署分支，也是默认分支。每个改动从它拉 `fix/<名字>` 或 `feat/<名字>`，开 PR 合回 `suyuan`。
- `upstream/main`：原作者的代码（remote `upstream` 指向 milind-soni/OpenMausBot）。GitHub 自动流程 `.github/workflows/suyuan-sync.yml` 每天把它合进 `suyuan`。
- 别的用户也会碰到的修复，另从 `upstream/main` 拉分支，把提交挑过去，给原作者开 PR。原作者收下后，在 `FORK.md` 把那一行标成「已还」。

改动一律做**加法**：新功能放新文件，原作者的文件只加接入用的几行。改动越少，每天合并原作者更新时越少冲突。

## 一个改动怎么走

1. **写代码。** 服务端逻辑、数据结构、接口的改动都带 vitest 用例：每天合并原作者的更新时，只有这些用例能发现我们的改动被弄坏了。只改样式和文案的不用写。用例放在新文件 `<被测文件>.suyuan.test.ts`，原作者的测试文件只改被我们改坏的断言。
   完成：相关用例是绿的，`pnpm typecheck` 和 `pnpm lint` 都过。
2. **在隔离实例上验。** 照 `docs/verification/README.md` 的「Launch」一节起一个隔离实例（临时数据目录，接假模型），用 lcu 在 Chrome 里打开它打印出来的地址，把改动涉及的每个界面状态都点一遍、截图。推送、通知这类 Chrome 能测的，先在 Chrome 里测。验证只用隔离实例：虚拟机上的 8799 端口和 `bot.tokenic.cn` 是夙愿正在用的 bot。
   完成：每个改到的界面状态都有截图，和预期一致。
3. **开 PR 合到 `suyuan`。** 正文写清为什么改、改了什么，以及第 1、2 步跑了什么命令、截了哪些图。
4. **独立审查一次。** 起一个没看过这次对话的 agent，只给它 PR 号和这次改动的目的：
   `env -u CLAUDECODE claude -p "<审查任务>" --model opus --effort xhigh --allowedTools "Read,Grep,Glob,Bash(git:*),Bash(gh pr view:*),Bash(gh pr diff:*)"`
   它提的意见由你判断改不改。改动大的，再让它审一次改过的部分，到此为止。
5. **CI 绿了就合并。** 合并会触发自动流程 `.github/workflows/suyuan-release.yml`，打出名为 `suyuan-v<版本>` 的 release，附 npm 安装包。
6. **部署。** 在 MacBook 的这个仓库里跑 `scripts/suyuan/deploy-vm.sh`：用 gh 下载最新 release，拷到虚拟机，由 `deploy-vm-remote.sh` 装上并重启服务（虚拟机访问 GitHub 时通时断，所以由 MacBook 中转）。脚本不会打断干活的 bot：有 bot 在忙就先等，最多等 10 分钟，等不到就什么都不装、直接退出。已经在跑这个版本时什么也不做。出问题就用 `--rollback` 换回上一版。
   脚本最长要跑十几分钟，用 Bash 的后台运行或把超时调到 15 分钟。断线不影响部署本身，日志在虚拟机的 `~/.openmausbot-releases/deploy.log`。
7. **交给夙愿手测。** 只留只有手机上才能判断的几项，比如真机推送、主屏幕网页 App 的手感。写清测什么、在哪测、看到什么算对。
   完成：`FORK.md` 的改动清单加了这一行。

## 虚拟机

- `ssh lizhi-vm` 登录。服务由 LaunchAgent `com.openmausbot.serve` 管，数据在 `~/.openmausbot`。那是夙愿的真实数据，只读着看。
- 升级只走 `deploy-vm.sh`。`npm install -g openmausbot` 会把 fork 换回官方版。
