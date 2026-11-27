# 真模型对比验收

改了模型看到的内容（提示拼装、补发历史、图片、说明文字）时用。假引擎只能证明内容送到了，模型会不会照着理解，要看真模型的回复。做法：同一个场景，改前、改后各起一个隔离副本，各跑几次，对比回复。

## 起副本

两个副本都在 MacBook 上跑，用本机真实 HOME，这样 Claude 的登录能直接用；数据目录和端口单独给。新数据目录里没有定时任务，也没有推送订阅。

```zsh
# 改后：当前工作区
mkdir -p /tmp/omb-real/new
OMB_DATA_DIR=/tmp/omb-real/new OMB_PORT=18931 OMB_WEBHOOK_PORT=18932 OMB_DISABLE_ANNOUNCEMENTS=1 OMB_DISABLE_MODEL_MANIFEST_FETCH=1 \
  PATH="$HOME/.local/bin:$PATH" nohup node --experimental-strip-types server/index.ts > /tmp/omb-real/new.log 2>&1 &

# 改前：基线提交单独开一个工作树，借用主仓的 node_modules
git worktree add /tmp/omb-real/oldsrc <基线提交>
ln -s "$PWD/node_modules" /tmp/omb-real/oldsrc/node_modules
mkdir -p /tmp/omb-real/old && cd /tmp/omb-real/oldsrc
OMB_DATA_DIR=/tmp/omb-real/old OMB_PORT=18921 OMB_WEBHOOK_PORT=18922 OMB_DISABLE_ANNOUNCEMENTS=1 OMB_DISABLE_MODEL_MANIFEST_FETCH=1 \
  PATH="$HOME/.local/bin:$PATH" nohup node --experimental-strip-types server/index.ts > /tmp/omb-real/old.log 2>&1 &
```

日志里出现 `openmausbot server on http://127.0.0.1:<端口>` 就是起好了。

## 跑场景

每个命令都带 `--url http://127.0.0.1:<端口>`。

1. `pnpm control:omb new-bot --name 测试`，再用 `set-model --bot <id> --instance claude --model <线上同款>` 换成出问题那个 bot 的模型（线上的模型在虚拟机 `~/.openmausbot/bots.json` 里查）。
2. 要带图：先 `curl -X POST -H 'content-type: image/jpeg' --data-binary @图.jpg <url>/api/attachments`，拿返回的 `path`，消息里单独一行写 `<attached-image path="<path>" name="image.png" />`。
3. `send` 发消息，`wait --timeout 300` 等它跑完，`messages` 读回复和附件。
4. 要逼系统新开会话、补发历史：用 `edit --message <某条用户消息 id>` 改掉一条旧消息。
5. 改后的副本至少跑 3 次；每次的回复都要对。模型的回答每次会有出入，一次对不能说明修好了。
6. 看模型实际收到了什么：本机 `~/.claude/projects/-private-tmp-omb-real-*/*.jsonl`，第一条 `type: "user"` 记录里有哪些 `image` / `text` 块。

验收标准：改前的副本能复现问题，改后的副本每次都没犯。同一个问题在两个副本上反应一样，说明这个问法分不出新旧，换一个问法。

## 收尾

```zsh
kill <两个副本的进程号>
git worktree remove --force /tmp/omb-real/oldsrc
trash /tmp/omb-real ~/.claude/projects/-private-tmp-omb-real-*
```

会花一点 Claude 额度，一轮大约十来次对话。
