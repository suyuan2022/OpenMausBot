#!/bin/zsh
# Installs a suyuan-v* release of suyuan2022/OpenMausBot on lizhi-vm and restarts the server.
#   deploy-vm.sh                 newest release
#   deploy-vm.sh suyuan-v<x>     that release
#   deploy-vm.sh --rollback      whatever was installed before the last deploy
# Add --force to restart even while a bot wrote in the last two minutes (a restart cuts its turn short).
set -euo pipefail

export PATH="$HOME/.hermes/node/bin:$HOME/.npm-global/bin:$PATH"
REPO=suyuan2022/OpenMausBot
LABEL=com.openmausbot.serve
STORE=$HOME/.openmausbot-releases
DB=$HOME/.openmausbot/messages.db
mkdir -p "$STORE"

force=0 target=""
for arg in "$@"; do
  case $arg in
    --force) force=1 ;;
    --rollback) target=$(cat "$STORE/previous") ;;
    *) target=$arg ;;
  esac
done

if [[ -z $target || $target == suyuan-v* ]]; then
  api=https://api.github.com/repos/$REPO/releases/${target:+tags/}${target:-latest}
  url=$(curl -fsSL "$api" | python3 -c 'import sys, json; print(next(a["browser_download_url"] for a in json.load(sys.stdin)["assets"] if a["name"].endswith(".tgz")))')
  target=$STORE/${url:t}
  if [[ ! -f $target ]]; then
    curl -fsSL -o "$target.part" "$url"
    mv "$target.part" "$target"
  fi
fi

recent=$(sqlite3 "$DB" "select count(*) from messages where at > (strftime('%s','now') - 120) * 1000" 2>/dev/null || echo 0)
if (( recent > 0 && force == 0 )); then
  echo "bots wrote $recent message(s) in the last two minutes; rerun later or add --force" >&2
  exit 2
fi

before=$(openmausbot --version)
current_spec=$(cat "$STORE/current" 2>/dev/null || echo "openmausbot@$before")
npm install -g "$target"
echo "$current_spec" > "$STORE/previous"
echo "$target" > "$STORE/current"

launchctl kickstart -k "gui/$(id -u)/$LABEL"
for _ in {1..60}; do
  curl -fs -o /dev/null http://127.0.0.1:8799/ && break
  sleep 2
done
curl -fs -o /dev/null http://127.0.0.1:8799/ || { echo "server is not answering on 8799; try: $0 --rollback --force" >&2; exit 1; }
echo "openmausbot $before -> $(openmausbot --version)"
ls -t "$STORE"/*.tgz 2>/dev/null | tail -n +6 | while read -r old; do trash "$old" 2>/dev/null || true; done
