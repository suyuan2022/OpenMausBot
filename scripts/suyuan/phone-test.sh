#!/bin/zsh
# A copy of this working tree for 夙愿 to try on the phone, while the real bot on 8799 keeps running: nothing is installed
# or restarted. It runs on the fake model with a made-up chat (a reply longer than a screen, one with a wide table, one
# that mixes tables, text and a code block, a short one) and one unread Inbox line; its data is a temporary folder, gone
# on stop. Run it on lizhi-vm.
#   phone-test.sh         build the web UI, (re)start the copy, open the tunnel, print a sign-in link
#   phone-test.sh link    a fresh sign-in link (each signs in one device, within 12 hours)
#   phone-test.sh stop    close the copy and the tunnel
# The way in: a Cloudflare quick tunnel (no account, no DNS, nothing to set up on the Beijing relay) from a new
# https://<four-words>.trycloudflare.com to the copy's 18900. The address changes with every start; `link` reads the
# current one from the tunnel's log.
set -euo pipefail
cd ${0:A:h}/../..

PORT=18900
# OpenMausBot ships its own cloudflared; one on the PATH works as well.
CLOUDFLARED=${commands[cloudflared]:-$HOME/.openmausbot/dist-native/cloudflared/darwin-arm64/cloudflared}
STATE=~/.omb-phone-test
SEED=scripts/suyuan/phone-test
url=http://127.0.0.1:$PORT

json() { node -e 'const d = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(eval(process.argv[1]))' "$1"; }

stop() {
  local pid
  # SIGINT lets phone-test-server.ts stop the server and remove the temporary data.
  if [[ -f $STATE/launcher.pid ]]; then
    pid=$(<$STATE/launcher.pid)
    kill -INT $pid 2>/dev/null || true
    for _ in {1..20}; do kill -0 $pid 2>/dev/null || break; sleep 0.5; done
  fi
  [[ -f $STATE/tunnel.pid ]] && kill $(<$STATE/tunnel.pid) 2>/dev/null || true
  rm -f $STATE/launcher.pid $STATE/tunnel.pid
}

public() { grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' $STATE/tunnel.log 2>/dev/null | head -1 || true; }

link() {
  local code address
  [[ -f $STATE/tunnel.pid ]] && kill -0 $(<$STATE/tunnel.pid) 2>/dev/null && address=$(public)
  [[ -n ${address:-} ]] || { echo "no tunnel is open: run phone-test.sh first" >&2; exit 1; }
  code=$(curl -fsS -X POST -H 'content-type: application/json' $url/api/auth/pairing \
    -d '{"label":"手机测试","ttlMs":43200000}' | json d.code)
  print -r -- "$address/pair#code=$code"
}

case ${1:-start} in
  stop) stop; exit ;;
  link) link; exit ;;
  start) ;;
  *) echo "usage: phone-test.sh [start|link|stop]" >&2; exit 2 ;;
esac

stop
mkdir -p $STATE
print -r -- '[]' > $STATE/calls.json
cp $SEED/short.md $STATE/reply.md
# tsc is skipped: the copy only needs the bundle, and pnpm check covers the types. The default heap runs out on this VM.
NODE_OPTIONS=--max-old-space-size=6144 pnpm exec vite build >&2

# The fake model answers each turn with reply.md and makes the calls in calls.json, both read again every turn.
OMB_TEST_PORTS=$PORT-$((PORT + 1)) FAKE_CLAUDE_REPLY_FILE=$STATE/reply.md FAKE_CLAUDE_TOOL_CALLS_FILE=$STATE/calls.json \
  nohup node --experimental-strip-types scripts/suyuan/phone-test-server.ts > $STATE/launch.log 2>&1 &
print $! > $STATE/launcher.pid
# A start that fails halfway closes what it opened.
trap stop EXIT
# zsh skips the EXIT trap when a signal kills it; exiting on the signal runs it.
trap 'exit 130' INT
trap 'exit 143' TERM HUP
for _ in {1..60}; do grep -q '"url"' $STATE/launch.log && break; sleep 0.5; done
# A range of one: $PORT or no start at all, since the tunnel only goes there.
grep -q "\"url\": \"$url\"" $STATE/launch.log || { cat $STATE/launch.log >&2; exit 1; }

# A fresh data folder opens on the first-run guide, which would cover the chat on the phone.
curl -fsS -X PATCH -H 'content-type: application/json' $url/api/config \
  -d '{"onboarding":{"completedAt":"2026-01-01T00:00:00.000Z","version":1,"reelSeen":true,"hintsSeen":["met-chief-v1"]}}' >/dev/null

bot=$(curl -fsS $url/api/bots | json '(Array.isArray(d) ? d : d.bots)[0].id')
omb() { node --experimental-strip-types scripts/control-omb.ts $1 --url $url --bot $bot ${@:2} >/dev/null; }
say() {  # say REPLY TEXT: one turn in the bot's main chat, the only one Simple mode shows, answered with $SEED/REPLY.md
  cp $SEED/$1.md $STATE/reply.md
  omb send --text "$2"
  omb wait --for turn --timeout 60
}
say long "来一条长的"
say table "再来一张表"
say mixed "再来一条混着表格、文字和代码的"
say short "最后一句短的"
print -r -- '[{"server":"agents","name":"message_person","input":{"message":"收件箱里的一条测试消息。"}}]' > $STATE/calls.json
say short "给我发条消息"
print -r -- '[]' > $STATE/calls.json

nohup $CLOUDFLARED tunnel --no-autoupdate --url $url > $STATE/tunnel.log 2>&1 &
print $! > $STATE/tunnel.pid
for _ in {1..60}; do [[ -n $(public) ]] && break; sleep 0.5; done
[[ -n $(public) ]] || { cat $STATE/tunnel.log >&2; exit 1; }
# The new address takes a few seconds to answer from outside.
for _ in {1..10}; do curl -fs -m 3 -o /dev/null $(public)/ && break; sleep 1; done
link
trap - EXIT
