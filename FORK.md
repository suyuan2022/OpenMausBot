# 这个 fork 改了什么

suyuan2022/OpenMausBot 是 [milind-soni/OpenMausBot](https://github.com/milind-soni/OpenMausBot) 的个人 fork，只给夙愿自己用。它每天自动合并原作者的更新，在上面叠一小组自己的改动。下面每一行就是一处改动：行数越多，每天合并的成本越高；原作者收下的标「已还」，下次同步后删掉那一行。

开发和部署流程见 `CLAUDE.md`。

## 改动清单

| 改动 | 为什么 | 改了哪些文件 | 还给原作者 |
|---|---|---|---|
| fork 的运维：每天同步原作者更新、合并后打安装包、虚拟机部署脚本，以及本文件和 `CLAUDE.md` | 只给自己用的部署方式 | `.github/workflows/suyuan-*.yml`、`scripts/suyuan/`、`CLAUDE.md`、`FORK.md`，全是新文件 | 不还 |
| 更新提示指向这个 fork：查本仓库的 `suyuan-v*` release，npm 装法的更新命令换成部署脚本 | 原来提示 `npm install -g openmausbot@latest`，照做会把 fork 换回官方版 | `server/update-check.ts` 4 行，`server/update-check.test.ts` 1 行断言；新文件 `server/update-check.suyuan.test.ts` | 不还 |
| 网页版推送（Web Push）：设置 → 通知里的「推送到这台设备」。bot 回完、提问、要审批时，App 关着或手机锁屏也弹通知，点开进那个对话；这台设备正开着那个对话时不推。开了推送的设备不再另弹页内通知；「完成时通知我」「通知音效」两个开关同样管推送 | 官方手机 App 闭源，推送绑在原作者的苹果账号上；主屏幕网页 App 从 iOS 16.4 起能收推送 | `server/index.ts` 改 2 行、不增行（这个文件不许变长，接入写在已有行末尾），`src/App.tsx` 2 行（和下一行共用），`src/components/NotificationSettingsRows.tsx` 2 行，`src/lib/notify.ts` 2 行；新文件 `server/suyuan/`、`src/suyuan/`、`public/suyuan-push-sw.js` | 可以还：先问原作者要不要 |
| 重连不打扰：App 被系统杀掉后重开，先显示上次离开时的画面，bot 数据加载完再换成实时界面；整屏的「正在连接你的机器人…」3 秒后还没连上才出现 | 主屏幕网页 App 在后台常被 iOS 杀掉，重开要经北京中转拉约 1 MB 的数据，这段时间整屏都是「正在连接」 | `src/main.tsx` 1 行；`src/App.tsx` 的 2 行接入调用 `src/suyuan/use-suyuan.ts`，推送也从这里接；新文件 `src/suyuan/last-frame.ts`、`src/suyuan/quiet-start.css` | 可以还：先问原作者要不要 |

## 待做

按顺序做，每做完一条移进上面的清单。

1. **盯进展。** 服务端盯梢工具 `wait_until` 补齐四样：触发后接着盯；触发时在原对话里叫醒 bot，由它读完变化再用人话说；新增「命令输出变了才触发」这种盯法；聊天顶部显示正在盯什么、上次检查是几点。工具说明写到 bot 看了就会用，不为某个场景定制。
2. **丢消息。** 同一个 bot 正在别的对话里干活时，发给它的消息排着队，最后没人回，也不报错。
3. **表格卡死。** 手机 Safari 打开网页版，一渲染表格就卡死。
4. **切换对话卡住、不报超时。** 同一个 bot 在两个对话之间切换时要关掉旧进程、起新进程，机器一忙就卡好几分钟，界面只显示「工作中」。
5. **排队中的消息删不掉。** 点删除没有反应。
6. **去掉轮换的状态文字。** bot 干活时只留头像加跳动的三个点，不显示「正在一点点推进」这类文字。
7. **撤销设备后推送不停。** 在「人员」里撤掉一台设备的登录后，它的推送订阅还留在服务端，照样收到通知。撤销时一并删掉那台设备的订阅。
