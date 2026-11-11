# 这个 fork 改了什么

suyuan2022/OpenMausBot 是 [milind-soni/OpenMausBot](https://github.com/milind-soni/OpenMausBot) 的个人 fork，只给夙愿自己用。它在原作者的代码上叠一小组自己的改动，需要原作者的更新时手动合并。下面每一行就是一处改动：行数越多，合并的成本越高；原作者收下的标「已还」，下次同步后删掉那一行。

开发和部署流程见 `CLAUDE.md`。

## 改动清单

| 改动 | 为什么 | 改了哪些文件 | 还给原作者 |
|---|---|---|---|
| fork 的运维：合并前的检查（三个任务同时跑，类型检查接着 `suyuan` 上次存下的结果增量查；原作者每个 PR 17 个任务的 `ci.yml` 在仓库的 Actions 设置里关着，文件不动）、合并后打安装包（服务端和前端两个构建同时跑）、虚拟机部署脚本（装完服务起不来会自己装回上一版）、给手机试的测试版（`phone-test.sh`：隔离实例加临时隧道，不动正在用的 bot），以及本文件和 `CLAUDE.md`；每天同步原作者更新的流程已停用 | 只给自己用的部署方式 | `.github/workflows/suyuan-*.yml`、`.github/actions/suyuan-setup/`、`scripts/suyuan/`、`CLAUDE.md`、`FORK.md`，全是新文件 | 不还 |
| 更新提示指向这个 fork：查本仓库的 `suyuan-v*` release，npm 装法的更新命令换成部署脚本 | 原来提示 `npm install -g openmausbot@latest`，照做会把 fork 换回官方版 | `server/update-check.ts` 4 行，`server/update-check.test.ts` 1 行断言；新文件 `server/update-check.suyuan.test.ts` | 不还 |
| 网页版推送（Web Push）：设置 → 通知里的「推送到这台设备」。bot 回完、提问、要审批时，App 关着或手机锁屏也弹通知，点开进那个对话；这台设备正开着那个对话时不推。开了推送的设备不再另弹页内通知；「完成时通知我」「通知音效」两个开关同样管推送 | 官方手机 App 闭源，推送绑在原作者的苹果账号上；主屏幕网页 App 从 iOS 16.4 起能收推送 | `server/index.ts` 改 2 行、不增行（这个文件不许变长，接入写在已有行末尾），`src/App.tsx` 2 行（和下一行共用），`src/components/NotificationSettingsRows.tsx` 2 行，`src/lib/notify.ts` 2 行；新文件 `server/suyuan/`、`src/suyuan/`、`public/suyuan-push-sw.js` | 可以还：先问原作者要不要 |
| 重连不打扰：App 被系统杀掉后重开，先显示上次那个对话的画面（停在最底部，和 App 打开后一样），bot 数据加载完淡出、换成实时界面；离开时停在 bot 列表、设置这类 App 回不去的页面，或者是点推送通知打开的，就不显示；整屏的「正在连接你的机器人…」2 秒后还没连上才出现 | 主屏幕网页 App 在后台常被 iOS 杀掉，重开要经北京中转拉约 1 MB 的数据，这段时间整屏都是「正在连接」 | `src/main.tsx` 1 行；`src/App.tsx` 的 2 行接入调用 `src/suyuan/use-suyuan.ts`，推送也从这里接；新文件 `src/suyuan/last-frame.ts`、`src/suyuan/quiet-start.css` | 可以还：先问原作者要不要 |
| 表格不再上下乱跳：简洁模式里，回复中表格卡片的宽度只由消息列决定，不跟着表格变 | 原作者的表格组件（`src/components/RichTable.tsx`）可用宽度一变就重新量一次：放得下就挤进消息宽度，放不下就换成固定列宽、左右滑。固定列宽会把消息列撑宽，撑宽后又放得下，于是切回去。列宽需求落在这两个宽度之间的表格（手机上约 273–312 像素）每帧来回切换，整段对话跟着上下跳，荔枝、穿搭对话里就有这样的表 | `src/suyuan/use-suyuan.ts` 1 行引入；新文件 `src/suyuan/steady-tables.css` | 该还：别的用户也会碰到。还的时候把这条 CSS 并进 `src/styles.css` |
| 手机上 bot 的回复排到右边：手机宽度的触屏上，简洁模式里 bot 的气泡和表格卡片一直排到右边，只在最右边留一条 28px 宽的竖栏，给点一下消息才出现的按钮上下叠着放（平时是表情回应、⋯ 两个；朗读或看原文时三个，竖栏跟着变高）；群聊的按钮和私聊一样，回复和复制收进 ⋯ 菜单；只在鼠标悬停时显示的时间不再占位置。电脑、iPad、高级模式不变 | 原作者按鼠标设计：气泡最多占一行的 80%、离右边至少 82px，表格卡片占 88%，每条消息旁还留着悬停才显示的时间。402px 宽的手机上，bot 回复右边空出 136px；群聊多两个按钮，空出 160px | `src/components/ChatView.tsx` 1 行（导出 `replyAndCopy`），`src/components/GroupView.tsx` 4 行，`src/components/GroupView.message-actions.test.ts` 改 3 行断言；新文件 `src/suyuan/wide-replies.css`，由 `src/suyuan/use-suyuan.ts` 引入 | 可以还：先问原作者要不要 |
| 手机上的表格卡片做成电脑上的样子：卡片从表头开始，不再在顶上空出 44px 一条放按钮；复制、下载、放大三个按钮缩成电脑上那样的小药丸，点一下表格才出现（电脑是鼠标停上去才出现；点按规则同消息按钮：短按、不动、不在控件上、没选中文字），再点一下或点别处收起；排序箭头平时不显示。代码块右上角的「复制、更多」小药丸也一样，点一下代码块才出现（原作者在触屏上一直显示，盖住第一行代码的末尾）。电脑、iPad 的表格不变 | 原作者的触屏规则（`RichTable.tsx` 的 `touch:pt-11`、`touch:opacity-100`）给卡片顶上留了一条 44px 的空带放三个 40px 按钮，每个表头都带箭头，手机上一张单行表比电脑上高出一半（125px 对 81px） | 新文件 `src/suyuan/phone-tables.css`、`src/suyuan/phone-code.css`、`src/suyuan/table-plate.ts`（点表格、点代码块的开关）、`src/suyuan/table-plate.suyuan.test.ts`；`src/suyuan/use-suyuan.ts` 3 行；`server/suyuan/wiring.test.ts` 加一条断言 | 不还：只为夙愿的手机用法 |
| 左滑返回：手机上从屏幕左边缘往右滑，bot 列表跟着手指滑进来；拖过屏幕宽度的三分之一或者快速一甩就打开，否则弹回去。从左边缘竖着划照常滚动对话。手机触屏上不再显示左上角的返回按钮（按钮还在页面里，左滑就是点它），群聊页头也不再给它留空；重开 App 时先盖上的上次画面里同样没有这个按钮 | 主屏幕网页 App 没有 iOS 的侧滑返回，回列表只能点左上角的按钮；有了左滑，这个按钮就多余了 | `src/suyuan/use-suyuan.ts` 5 行接入；新文件 `src/suyuan/swipe-back.ts`，`src/suyuan/last-frame.ts` 存画面时调用它 | 可以还：先问原作者要不要 |
| 点已经打开的群组能收起列表：手机上 bot 列表盖住整屏时，点当前已经打开的群组或群里的对话，列表收起、回到对话；勾选对话做批量操作时不收起 | 原作者只处理了点当前 bot 的情况，点当前群组没反应，得先点别的再点回来 | `src/components/Sidebar.tsx` 1 行 | 可以还：别的用户也会碰到 |
| 列表里 bot 那行只为它自己的对话显示「工作中」：它在群里干活时，那行照常显示私聊的最后一句，由群组那行显示谁在干活 | 原来 bot 在群里干活时，列表里它那行也显示「思考中」，看着像私聊在忙 | `src/components/SidebarBotActivity.tsx`、`src/components/sidebar-preview.ts` 各 2 行接入，`src/components/SidebarBotListItem.expansion.test.ts` 改 1 条用例的数据（让那个对话本身在忙）；新文件 `src/suyuan/own-work.ts` | 不还：这是夙愿自己的偏好 |
| 群组「自动」由 DeepSeek 挑谁来回答：设成「自动」的群里，没 @ 任何人的消息先交给 DeepSeek（经 LithosAI 中转、关掉思考），它读群里的聊天文字（不含工具调用；引用回复时连同被引用的那句），只回一个 bot 名字，就由那个 bot 来回，用时约 0.5–2 秒；3 秒内没答上来、或者答的不是群里的 bot，就由群的负责人回。由它挑的回复下面写着「自动挑选」，没有这行的就是退回给了负责人。新建的群默认「自动」。群设置里的文案不再提 Jev，「Jev 已关闭」的提示不再显示。地址、模型、密钥写在数据目录的 `suyuan-room-router.json`，没有这个文件就和原来一样 | 原作者的自动分派要 TypeSafe Jev 的密钥，没有就一律交给负责人 | `server/index.ts` 改 8 行、不增行，`src/locales/zh.json` 改 5 句文案，`src/suyuan/use-suyuan.ts` 1 行引入；新文件 `server/suyuan/room-router.ts`、`src/suyuan/room-router.css`（「自动挑选」这几个字写在这里：语言包要求那句保留百分比占位符） | 不还 |
| 干了很多步的 bot 不会把前面的对话挤掉：对话页一次最多画 120 条消息，现在只数页面上看得见的消息，bot 调用工具的步骤（简洁模式里不单独显示）不算在内；对话停在最底部、内容又不满一屏时，自动往前多拉几页更早的消息，最多 20 页（1000 条） | bot 一轮调用几百次工具时，这 120 条全是看不见的工具步骤：买鞋群里 shopping 一轮跑了 354 步，页面只剩最后一问一答，往上滑能看到前面，滑回底部前面又消失。重开 App 时服务端先给最后 50 条，也全是工具步骤，对话里一条消息都没有，只剩「工作中」 | `src/hooks/use-transcript-viewport.ts` 9 行，`src/lib/transcript-window.ts` 2 行，`src/hooks/use-transcript-viewport.test.ts` 改 1 条断言（打开时自动补的那一页）；新文件 `src/suyuan/drawn-window.ts`、`src/suyuan/fill-short-chat.ts` | 该还：别的用户也会碰到 |
| 不显示「尚未收到 Claude 的回复」：bot 开始干活 20 秒后 Claude 还没出声时，原作者会在对话里插一条这样的提示，带「切换 AI」「连接你的订阅」两个按钮；这里默认关掉，环境变量 `OMB_FIRST_REPLY_NOTICE_MS` 设成正数能重新打开 | 两个按钮都用不上，等待时「工作中 · 计时」那行已经在走；插话或停止后 Claude 常要过一两分钟才出声，这条提示每次都冒出来 | `server/suyuan/register.ts` 1 行 | 不还：这是夙愿自己的偏好 |
| 手机上点 bot 的回复，按钮出现在手指旁边，滑动时不乱冒：点一下回复，表情和 ⋯ 两个按钮出现在点到的那一块旁边（带表格的回复画成几块：气泡、表格卡片；一块比按钮高就停在手指的高度，矮就居中）；按钮亮着时点同一条回复的另一块，按钮移到那一块旁边，点它所在的那一块才收起；按住半秒后手指接着滑，冒出来的按钮收回去；滑动中途按一下让它停住，这一下不算点；按钮的 ⋯ 菜单打开时盖在表格右上角那排按钮上面 | 按钮原来钉在回复的最底边，表格回复钉在第一段旁边，比一屏长的回复点了，按钮在屏幕外（402×874 的手机上量到在屏幕顶上 366px 外），看着像没反应；手指停半秒再滑会被当成长按，滑着滑着按钮就冒出来；按钮那一栏是第 1 层，菜单关在里面，表格角上的按钮在第 20 层，压住菜单上半截 | `src/components/MessageActions.tsx` 28 行（长按后滑动收回、刹停的那一下不算点、点另一块时按钮移过去）；`src/suyuan/use-suyuan.ts` 1 行接入；`src/suyuan/wide-replies.css` 加 1 条；新文件 `src/suyuan/tray-at-finger.ts`，用例 `src/components/MessageActions.suyuan.test.ts`、`src/suyuan/tray-at-finger.test.ts`、`src/suyuan/tray-at-finger.dom.test.ts` | `MessageActions.tsx` 那部分该还：别的手机用户也会碰到；按钮跟手指走只在本 fork 的竖栏布局里需要 |
| 手机上收件箱是右上角「+」左边的一个圆按钮：有事等夙愿时右上角一个红点，不显示数字；原来头像下面那一整行收件箱在手机上去掉。电脑上不变 | 那一行把 bot 列表整个往下推了一行，收件箱用得没那么频繁，不值得占一整行 | `src/components/Sidebar.tsx` 3 行；新文件 `src/suyuan/PhoneInboxButton.tsx`，用例 `src/suyuan/PhoneInboxButton.dom.test.ts` | 不还：个人偏好 |
| 手机首页和电脑一样用头像方块：简洁模式下，Chief（荔枝）和置顶的 bot 并排成一排头像方块放在最上面，列表里不再有「已置顶」分组，也不再有 Chief 单独的大头像；长按方块半秒打开这个 bot 的菜单（电脑上是右键），没选中的方块不带底色。高级模式的手机首页不变 | 手机上 Chief 是顶上一个大头像，置顶的 bot 却在列表里另起一个「已置顶」分组，和电脑上不是一个样子；夙愿要手机照电脑的来 | `src/components/Sidebar.tsx` 6 行（「电脑上的简洁模式」这个判断在 6 处换成「简洁模式」）；新文件 `src/suyuan/tile-menu.ts`、`src/suyuan/phone-tiles.css` | 不还：个人偏好 |
| 手机上不能双指缩放，图片只下载一次：触屏上页面不再被双指捏合、双击缩放（滚动照常，电脑浏览器不变），图片预览里图片自己能双指缩放（1–5 倍）、放大后拖动、双击在 1 倍和 2.5 倍间切换；对话里的图片（他发的、bot 回的、头像）服务端回一年的强缓存，音频和别的文件仍不缓存；共享工作区里只看得到部分 bot 的成员、团队版、企业工作区照原作者一律不缓存（那里一份缓存可能被另一个身份看到） | 原来每次重开 App 都把图片重新下一遍，北京中转出口只有约 3 Mbps，跳回 App 要等很久；图片名是随机 UUID、内容不变，缓存安全 | `server/routes/threads.ts` 1 行（viewport 的 maximum-scale 由 `no-zoom.ts` 在触屏上运行时加，`index.html` 不动：上游 `web-app-assets.test.ts` 不许它出现在页面里）、`src/suyuan/use-suyuan.ts` 5 行接入，`server/suyuan/wiring.test.ts` 1 条断言；新文件 `server/suyuan/attachment-cache.ts`、`src/suyuan/no-zoom.ts`、`src/suyuan/no-zoom.css`、`src/suyuan/preview-zoom.ts` | 可以还：先问原作者要不要 |
| 手机首页的头像和 + 往上挪 6px：整行（`data-sidebar-top-row`）底部加 12px 内边距，行高不变、下面的列表不动；头像和 + 离状态栏底边从 12px 变成 6px，不贴近时间 | 夙愿觉得首页左上角头像、右上角加号离顶太远 | 新文件 `src/suyuan/phone-header.css`；`src/suyuan/use-suyuan.ts` 1 行引入 | 不还 |
| 输入框右下角的语音对话（实时通话）圆钮默认不显示：设置的「通用」里有「显示语音对话按钮」开关，打开才出现；开关存在本机（localStorage），每台设备各管各的。关着时简洁模式 + 菜单里的通话选项也一并隐藏；通话进行中按钮照常显示，好挂断。圆钮藏着时，手机上和电脑简洁模式里的空输入框在那个位置留一个变淡、点不动的发送键，打了字才亮起来；bot 在干活时那个位置照旧是停止 | 夙愿用不上语音对话，圆钮占着输入框右端 | `src/components/Composer.tsx` 9 行、`src/components/SettingsModal.tsx`、`src/components/SettingsSimplePages.tsx`（简洁模式）各 2 行接入；`Composer.simple.test.ts`、`Composer.phone.test.ts` 在开头打开开关、`ChatView.controls.test.ts` 改成断言默认不显示；新文件 `src/suyuan/voice-button.ts`、`src/suyuan/VoiceButtonRow.tsx` | 不还：这是夙愿自己的偏好 |
| 打字时没有停止按钮：bot 在干活、输入框里有字或有附件时，只剩发送（插话）按钮，不再在它旁边留一个停止；输入框空着时照旧是停止；等审批（输入框被禁用）或附件上传中时，有字也留着停止 | 想插话点发送，旁边的停止紧挨着，容易误点停掉 bot | `src/components/Composer.tsx` 1 行条件，`src/components/Composer.simple.test.ts` 改 1 条断言 | 不还：原作者有意在打字时保留停止（上游用例原标题 keeps a quiet Stop beside Send while you type），这是夙愿自己的偏好 |
| Claude 的对话由 Claude Code 自己压缩：服务端不再在一轮开头抢先折叠、换新会话（手动「立即压缩」照旧）；闲时压缩从闲 3 分钟改成闲 55 分钟，58 分钟前没做成就不做，开着保温的对话闲时不压。要配合 `config.json` 里 Claude 账号的环境变量 `OMB_CLAUDE_AUTOCOMPACT=333000`（和包装脚本同一条线），否则服务端仍按 20 万算「快到线了」。代价：编辑消息、切换版本、换备用模型再换回这类要从聊天记录重建会话的情况，长对话不再有那段折叠总结，只带最近 24KB | 服务端按「Claude 压缩线的九成」先折叠，而它以为压缩线是默认 20 万，包装脚本实际设的是 33.3 万：每到 18 万左右就只剩一段 6KB 的总结开新会话，11/9 晚 Maus 工程师两次被冲掉目标。闲 3 分钟就压，人还没走就丢细节 | `server/index.ts` 改 2 行、不增行；`server/warm-summary.ts` 两个时长；`server/host/warm-summary-host.ts` 3 行；`docs/verification/context-compaction.md` 3 处；上游用例 `server/context-compaction.e2e.test.ts`、`server/warm-summary.test.ts`、`server/warm-summary.e2e.test.ts` 只改被改坏的断言；新文件 `server/suyuan/native-compact.ts`、`server/warm-summary.suyuan.test.ts`、`server/host/warm-summary-host.suyuan.test.ts` | 不还：原作者有意先折叠 |
| Chief 能只读查队友的对话：荔枝这样的 Chief of Staff 多了两个工具，`team_threads`（按 bot 列它最近的 1:1 对话：标题、状态、最后活动时间、threadId）和 `team_thread_read`（读某条对话最近 N 条消息：谁说的、时间、正文，正文和条数都有上限，工具调用只给一行）。只读：不标已读、不写入、不唤醒那个 bot；只限 Chief 管得到的 bot（同一套 `canManage` 判定），房间不管 | 荔枝要看 Maus 工程师说到哪了，原来只能直接读 `messages.db` | 新文件 `server/suyuan/chief-read-threads.ts`、`server/suyuan/chief-read-tools.ts` 及用例；`server/routes/internal-threads.ts` 4 行，`server/drivers/agents-catalog.ts` 3 行、`server/drivers/agents-call.ts` 2 行、`server/agent-tool-policy.ts` 2 行、`server/activity.ts` 2 行、`src/locales/en.json` 2 行，工具清单金样和几处测试里的清单/体积基线 | 可以还：别的 Chief 也会想看队友在干什么 |
| 递话放开：coordinate_bots 用 `thread: <id>` 往别人开的对话（夙愿开的、别的 bot 开的）里递单向通知（`reply: "none"`）也行。条件和原作者让 Chief 替人答话的一样：这一轮背后有人（webhook、定时任务起的不行），来源对话在围栏和 bot API 之外、自己不带外来标记（webhook 跑出来的、读过邮件的对话里，夙愿亲自发话也不行）；外部运行（EXTERNAL）的 bot 一律不行；对方对话正在等夙愿回答时也不收。递话不改那条对话的批准级别和「始终允许」，不改它的开启者，回报不会发给递话的 bot。要回报的活仍是原作者的拒绝 | 原来只能往自己开的对话递话，Chief 想往夙愿开在 Maus 工程师身上的对话补一句被拒 | 新文件 `server/suyuan/relay-gate.ts`、用例 `server/host/work-thread.suyuan.test.ts` 和 `server/suyuan/relay-any-thread.suyuan.e2e.test.ts`；原作者文件：`server/host/work-thread.ts` 加 5 行（一个可选输入、一条放行），`server/index.ts` 改 3 行（接入那行还带 EXTERNAL 排除）（接入、级别下传加条件、一行 import），行数不增；原作者的测试没动 | 可以还：别家框架都是按编号投递 |
| 模型把工具调用又用文字写一遍时，这段不进聊天消息：Gemini 4 经 Antigravity 接入时，每次调用工具前说的那句话后面会跟一段 `工具调用_start:[{…}]工具调用_end`（这次调用的 JSON）。真正的工具调用照常执行、照常画成步骤，这段文字副本从消息里去掉：服务端存的新消息里没有，界面画已存的旧消息时也不显示。只认两头标记齐全、中间是调用列表的整段，讲解这个标记的文字和代码不受影响 | 2026-11-10「内容创作」bot（gemini-4-argon）32 条回复里 31 条带着这段，每段几百字 JSON；同一个模型在 Antigravity 自己的窗口里 60 条回复一条都没有，起因没查明，所以在这里过滤 | `shared/system-message-guard.ts` 2 行；新文件 `shared/suyuan/tool-echo.ts`，用例 `shared/suyuan/tool-echo.suyuan.test.ts` | 可以还：先问原作者要不要 |
| 所有 bot 都读的规矩（上游）：设置 → 通用 → 账户里点「添加」展开个人资料，「关于我」下面多了「所有机器人的规则」文本框，存进 `config.json` 的 `everyBotRules`（只有管理员看得到），私聊和群聊的系统提示词里放在每个 bot 自己的指令（SOUL）前面，包成一个 JSON 字符串；清空就整节不出现。同一个提交还带来：记忆整理把做完或两周没动的工作记录从 MEMORY.md 移到对应主题，不移「always / never / from now on」开头的规矩；bot 设置里在每轮都加载的文本超过 24KB（其中记忆至少 8KB）时出现「这个机器人每轮都会加载很多内容。」和「整理记忆」按钮；简洁模式的指令编辑器下面有「改动记录」，能撤销。代价：规矩和 SOUL、bot 名字一样算进会话配置，改一次规矩后，每条对话下一次收到队友回报（或别的外部更新）时不续原来的 Claude 会话，只带最近 24KB 聊天记录重开；本 fork 没有服务端的折叠总结，24KB 之前的内容就不在新会话里了 | 夙愿要一个所有 bot 都读的规矩位，上游已经做了 | 上游提交 `7adc19c74`（上游 PR #4987）原样拿来，47 个文件，没改一个字 | 来自上游：下次整体合上游后删掉这一行 |
| 切换对话只拉最新 80 条（上游）：切进一个对话或群里的对话时请求最新 80 条，原来是 200 条；往上滚照旧按 200 条一页拉更早的 | 长对话带着大段工具输入时 200 条能到约 3 MB，经北京中转要等好几秒 | 上游提交 `fad2d0733` 原样拿来：`src/state/store.tsx` 3 行，测试 `src/state/chat-switch-page.test.ts`、`src/state/room-navigation.test.ts` | 来自上游：下次整体合上游后删掉这一行 |
| Claude Code 不认 `--autocompact` 时不再每轮失败（上游）：某个版本的 Claude Code 启动时报 `unknown option '--autocompact'`，服务端记下这个版本，之后不再给它这个参数，这一轮去掉参数在原处重来；装回这个版本也不会再加上 | 2.1.129 这类版本 `--help` 里列着 `--autocompact` 却拒收，原来每一轮都启动失败 | 上游 PR #5048（`d4bf62972^1..d4bf62972^2` 的 9 个提交，其中 2 个是空的重跑 CI 提交，没拿）原样拿来：`server/drivers/claude.ts`、`server/drivers/claude.test.ts`、`server/testing/fake-claude-cli.ts` | 来自上游：下次整体合上游后删掉这一行 |
| `coordinate_bots` 的工具说明跟上「递话放开」：说明里写明单向通知（`reply: "none"`）也能递进夙愿或别的 bot 开的对话，不只是自己开的；定时任务、webhook 起的这一轮，或来源对话带外来标记时被拒，报错直接说是这个原因、让它在回复里说要转达什么，不再说「这不是你开的对话」 | 所有 bot 都读这份说明；原来写着只能指定自己开的对话，bot 照着说明就不会去递；被拒时的报错和说明对不上，bot 会以为编号错了、另开一条对话 | `server/drivers/agents-catalog.ts` 1 行，工具清单金样 `server/drivers/agents-catalog-goldens/` 4 个文件重新生成（体积多约 100 字节，在原作者 2% 的预算内，`BUDGET_BASELINE` 没动）；`server/suyuan/relay-gate.ts` 的拒绝原因和它的两份用例 | 跟「递话放开」一起还 |
| 一个 bot 一个家（前两步，完整规则见「待做」里同名一节）：简洁模式下，每个 bot 有一条固定的对话（家），别的对话是后台运行。后台运行有未读、在干活时，bot 那行不亮红点、不显示工作中、下面不出子行、不计入 App 图标数字，点 bot 进的是家；它正等夙愿批准或回答时照常亮、照常带他进去。进到后台运行里（从派活消息下的小标签），输入框换成一行「后台对话，只能看」和「返回你的聊天」；它等批准或回答期间保留输入框，批准卡就画在那里。服务端：家是夙愿选定的那条，没选过就在不由 bot 开的对话里按原作者的规则挑；bot 关不掉家（`close_thread` 拒绝，派活干完的自动关也跳过）；点名往家里派要回报的活被拒，沿用的工作对话已成了家就另开一条，单向通知照收。简洁模式里不再提供别的对话：对话页和群的「⋯」菜单没有「新对话」和「切换对话」，bot 的菜单没有「新对话」「查看对话」「设为主对话」，bot 面板没有对话列表，Cmd/Ctrl+Shift+N 不新建对话，定时任务的结果去向只能选家；对话太长时的提示改成「要聊另一件事，可以新建一个群聊」。这些判断由 App 外壳每次渲染时告诉 fork 的模块「对话列表是否隐藏」才生效，所以原作者的用例一条没改。高级模式不变 | 点 bot 会被带进「有未读」或「在干活」的对话，常常是别的 bot 派活开的那条，夙愿在里面接着聊，它就成了主对话：11 个 bot 里 5 个是这么来的 | `server/index.ts` 改 4 行、不增行，`server/host/work-thread.ts` 6 行，`server/routes/internal-threads.ts` 2 行，`src/components/ChatView.tsx` 改 3 行、不增行，`src/state/thread-navigation.ts`、`src/components/SidebarBotActivity.tsx`、`src/components/SidebarBotMenu.tsx`、`src/App.tsx`、`src/components/bot-panel/DetailsTab.tsx`、`src/components/routines/ResultsDestination.tsx` 各 2 行，`src/lib/bot-unread.ts`、`src/components/ChatMoreMenu.tsx`、`src/components/RoomMoreMenu.tsx` 各 3 行，`src/locales/zh.json` 1 句；新文件 `server/suyuan/home.ts`、`src/suyuan/home.ts`、`src/suyuan/BackgroundRunBar.tsx` 和三份用例，`src/suyuan/own-work.ts`、`src/suyuan/use-suyuan.ts` 接入 | 不还：原作者有意让多条对话并存 |

## 待做

按顺序做，每做完一条移进上面的清单。

1. **盯进展。** 服务端盯梢工具 `wait_until` 补齐四样：触发后接着盯；触发时在原对话里叫醒 bot，由它读完变化再用人话说；新增「命令输出变了才触发」这种盯法；聊天顶部显示正在盯什么、上次检查是几点。工具说明写到 bot 看了就会用，不为某个场景定制。
2. **丢消息。** 同一个 bot 正在别的对话里干活时，发给它的消息排着队，最后没人回，也不报错。
3. **表格卡死。** 手机 Safari 打开网页版，一渲染表格就卡死。上面「表格不再上下乱跳」修掉的来回切换会让整张表每帧重排一次，可能就是卡死的原因；手机上确认不再卡死后移进清单。
4. **切换对话卡住、不报超时。** 同一个 bot 在两个对话之间切换时要关掉旧进程、起新进程，机器一忙就卡好几分钟，界面只显示「工作中」。
5. **排队中的消息删不掉。** 点删除没有反应。
6. **去掉轮换的状态文字。** bot 干活时只留头像加跳动的三个点，不显示「正在一点点推进」这类文字。
7. **撤销设备后推送不停。** 在「人员」里撤掉一台设备的登录后，它的推送订阅还留在服务端，照样收到通知。撤销时一并删掉那台设备的订阅。

### 一个 bot 只有一条和夙愿的对话

排在上面七条之前做，分三步。前两步做完了，在上面的清单里；还剩第三步。

**做成什么样。** 每个 bot 有一条固定的对话，下面叫它的「家」：夙愿和这个 bot 说话只在这里。bot 身上别的对话都算后台运行，包括别的 bot 派活开的、定时任务每次跑的、bot 自己另开的。后台运行不进任何列表、不亮红点，点 bot 不会被带进去；夙愿能进去看，不能在里面说话。

**为什么。** 夙愿不想管多条对话。原来点一个 bot，会被带进「有未读」或「正在干活」的那条，常常是别的 bot 派活开的；他在里面接着聊，那条就成了主对话。2026-11-11 虚拟机上 11 个 bot 里有 5 个的主对话是这么来的，22 条 bot 开的对话里 11 条有他的发言。

**规则。**

- 家怎么定：夙愿选定的那条（bot 记录上的 `mainThreadChoice`，原作者「设为主对话」存的就是它）；没选过的，在不由 bot 开的对话里按原作者的规则挑（他最后写过字的那条，没写过就是最早建的），对只有一条自己对话的 bot 来说就是和 bot 一起建的那条。bot 新建的 bot 同样如此。
- 家可以是别的 bot 开的对话（那 5 个就是）。为此有三处例外：开它的 bot 不能关它；别的 bot 再派活不落进家里，另开一条；「最近工作」把它写成和夙愿的主对话。
- 一条对话什么时候算「在找夙愿」：它是家，或者它正等他批准、等他回答。红点、点 bot 打开哪条、bot 下面的子行、收件箱的「进行中」、App 图标上的数字，全用这一条判断。
- 后台运行要他批准或回答时，卡片出现在收件箱，在那里直接答，答完它接着跑（2026-11-11 在隔离实例上测过批准卡和两种提问卡）；点 bot 进到那条对话里答也行，等他期间那里保留输入框。bot 的批准级别是「Just do it」时不会问人，也就没有卡片。有一种只在收件箱里看得到：bot 那一轮已经结束、留下一个问题（回复里写 `NEEDS INPUT`），这时 bot 那行不亮。
- 想插手一件正在后台跑的活，跟派活的那个 bot 说，由它递话。
- 从哪里看后台运行：派活那条消息下面的小标签，点进去只读，输入框的位置是一行说明和「返回你的聊天」。
- 后台对话不用关，看不见就行。
- 没有「新对话」：bot 和群的菜单、bot 面板、快捷键 Cmd/Ctrl+Shift+N 里的入口都去掉，提示里说「开个新对话」的地方改成指向新建群聊。群也是一个群一条对话。
- 家怎么知道后台干过什么：系统提示词里的「最近工作」一段（服务端每轮从聊天记录现算，列这个 bot 48 小时内在别的对话里做了什么）。后台运行那一行写成「谁派的 · 派了什么 · 结论」，还没回话的也占一行。细节由 bot 自己搜聊天记录。
- 记忆：派来的活本身不记；活里得知的长期事实，由现有的记忆整理照常记下。群聊里的也记（打开 `features.roomMemoryCapture`）。
- 这些只在简洁模式下生效。高级模式照原作者的来，对话列表、新对话都在，出问题时可以切过去。

**不改的。** bot 之间派活的机制；电脑上的 Claude 找 bot 的方式（走一次性定时任务，本来就是后台运行）；bot 自己另开的对话，结果暂时不带回家。

**还剩一步。** 改写「最近工作」那一行和写给 bot 看的工具说明。它和 PR #29（系统提示词里每回合会变的内容不再让缓存失效）改同一段，叠在它上面做。

**上线时改两处真实数据，改前备份。** 给现有 11 个 bot 设家（夙愿逐个定过）；打开群聊记忆。
