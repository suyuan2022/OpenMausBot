# 这个 fork 改了什么

suyuan2022/OpenMausBot 是 [milind-soni/OpenMausBot](https://github.com/milind-soni/OpenMausBot) 的个人 fork，只给夙愿自己用。它在原作者的代码上叠一小组自己的改动，需要原作者的更新时手动合并。下面每一行就是一处改动：行数越多，合并的成本越高；原作者收下的标「已还」，下次同步后删掉那一行。

开发和部署流程见 `CLAUDE.md`。

## 改动清单

| 改动 | 为什么 | 改了哪些文件 | 还给原作者 |
|---|---|---|---|
| fork 的运维：合并后打安装包、虚拟机部署脚本、合并前装到手机上试的测试版，以及本文件和 `CLAUDE.md`；每天同步原作者更新的流程已停用 | 只给自己用的部署方式 | `.github/workflows/suyuan-*.yml`、`scripts/suyuan/`、`CLAUDE.md`、`FORK.md`，全是新文件 | 不还 |
| 更新提示指向这个 fork：查本仓库的 `suyuan-v*` release，npm 装法的更新命令换成部署脚本 | 原来提示 `npm install -g openmausbot@latest`，照做会把 fork 换回官方版 | `server/update-check.ts` 4 行，`server/update-check.test.ts` 1 行断言；新文件 `server/update-check.suyuan.test.ts` | 不还 |
| 网页版推送（Web Push）：设置 → 通知里的「推送到这台设备」。bot 回完、提问、要审批时，App 关着或手机锁屏也弹通知，点开进那个对话；这台设备正开着那个对话时不推。开了推送的设备不再另弹页内通知；「完成时通知我」「通知音效」两个开关同样管推送 | 官方手机 App 闭源，推送绑在原作者的苹果账号上；主屏幕网页 App 从 iOS 16.4 起能收推送 | `server/index.ts` 改 2 行、不增行（这个文件不许变长，接入写在已有行末尾），`src/App.tsx` 2 行（和下一行共用），`src/components/NotificationSettingsRows.tsx` 2 行，`src/lib/notify.ts` 2 行；新文件 `server/suyuan/`、`src/suyuan/`、`public/suyuan-push-sw.js` | 可以还：先问原作者要不要 |
| 重连不打扰：App 被系统杀掉后重开，先显示上次那个对话的画面（停在最底部，和 App 打开后一样），bot 数据加载完淡出、换成实时界面；离开时停在 bot 列表、设置这类 App 回不去的页面，或者是点推送通知打开的，就不显示；整屏的「正在连接你的机器人…」2 秒后还没连上才出现 | 主屏幕网页 App 在后台常被 iOS 杀掉，重开要经北京中转拉约 1 MB 的数据，这段时间整屏都是「正在连接」 | `src/main.tsx` 1 行；`src/App.tsx` 的 2 行接入调用 `src/suyuan/use-suyuan.ts`，推送也从这里接；新文件 `src/suyuan/last-frame.ts`、`src/suyuan/quiet-start.css` | 可以还：先问原作者要不要 |
| 表格不再上下乱跳：简洁模式里，回复中表格卡片的宽度只由消息列决定，不跟着表格变 | 原作者的表格组件（`src/components/RichTable.tsx`）可用宽度一变就重新量一次：放得下就挤进消息宽度，放不下就换成固定列宽、左右滑。固定列宽会把消息列撑宽，撑宽后又放得下，于是切回去。列宽需求落在这两个宽度之间的表格（手机上约 273–312 像素）每帧来回切换，整段对话跟着上下跳，荔枝、穿搭对话里就有这样的表 | `src/suyuan/use-suyuan.ts` 1 行引入；新文件 `src/suyuan/steady-tables.css` | 该还：别的用户也会碰到。还的时候把这条 CSS 并进 `src/styles.css` |
| 手机上 bot 的回复排到右边：手机宽度的触屏上，简洁模式里 bot 的气泡和表格卡片一直排到右边，只在最右边留一条 28px 宽的竖栏，给点一下消息才出现的按钮上下叠着放（平时是表情回应、⋯ 两个；朗读或看原文时三个，竖栏跟着变高）；群聊的按钮和私聊一样，回复和复制收进 ⋯ 菜单；只在鼠标悬停时显示的时间不再占位置。电脑、iPad、高级模式不变 | 原作者按鼠标设计：气泡最多占一行的 80%、离右边至少 82px，表格卡片占 88%，每条消息旁还留着悬停才显示的时间。402px 宽的手机上，bot 回复右边空出 136px；群聊多两个按钮，空出 160px | `src/components/ChatView.tsx` 1 行（导出 `replyAndCopy`），`src/components/GroupView.tsx` 4 行，`src/components/GroupView.message-actions.test.ts` 改 3 行断言；新文件 `src/suyuan/wide-replies.css`，由 `src/suyuan/use-suyuan.ts` 引入 | 可以还：先问原作者要不要 |
| 左滑返回：手机上从屏幕左边缘往右滑，bot 列表跟着手指滑进来；拖过屏幕宽度的三分之一或者快速一甩就打开，否则弹回去。从左边缘竖着划照常滚动对话 | 主屏幕网页 App 没有 iOS 的侧滑返回，回列表只能点左上角的按钮 | `src/suyuan/use-suyuan.ts` 2 行接入；新文件 `src/suyuan/swipe-back.ts` | 可以还：先问原作者要不要 |
| 干了很多步的 bot 不会把前面的对话挤掉：对话页一次最多画 120 条消息，现在只数页面上看得见的消息，bot 调用工具的步骤（简洁模式里不单独显示）不算在内；对话停在最底部、内容又不满一屏时，自动往前多拉几页更早的消息，最多 20 页（1000 条） | bot 一轮调用几百次工具时，这 120 条全是看不见的工具步骤：买鞋群里 shopping 一轮跑了 354 步，页面只剩最后一问一答，往上滑能看到前面，滑回底部前面又消失。重开 App 时服务端先给最后 50 条，也全是工具步骤，对话里一条消息都没有，只剩「工作中」 | `src/hooks/use-transcript-viewport.ts` 9 行，`src/lib/transcript-window.ts` 2 行，`src/hooks/use-transcript-viewport.test.ts` 改 1 条断言（打开时自动补的那一页）；新文件 `src/suyuan/drawn-window.ts`、`src/suyuan/fill-short-chat.ts` | 该还：别的用户也会碰到 |

## 待做

按顺序做，每做完一条移进上面的清单。

1. **盯进展。** 服务端盯梢工具 `wait_until` 补齐四样：触发后接着盯；触发时在原对话里叫醒 bot，由它读完变化再用人话说；新增「命令输出变了才触发」这种盯法；聊天顶部显示正在盯什么、上次检查是几点。工具说明写到 bot 看了就会用，不为某个场景定制。
2. **丢消息。** 同一个 bot 正在别的对话里干活时，发给它的消息排着队，最后没人回，也不报错。
3. **表格卡死。** 手机 Safari 打开网页版，一渲染表格就卡死。上面「表格不再上下乱跳」修掉的来回切换会让整张表每帧重排一次，可能就是卡死的原因；手机上确认不再卡死后移进清单。
4. **切换对话卡住、不报超时。** 同一个 bot 在两个对话之间切换时要关掉旧进程、起新进程，机器一忙就卡好几分钟，界面只显示「工作中」。
5. **排队中的消息删不掉。** 点删除没有反应。
6. **去掉轮换的状态文字。** bot 干活时只留头像加跳动的三个点，不显示「正在一点点推进」这类文字。
7. **撤销设备后推送不停。** 在「人员」里撤掉一台设备的登录后，它的推送订阅还留在服务端，照样收到通知。撤销时一并删掉那台设备的订阅。
