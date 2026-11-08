#!/bin/zsh
# Installs a suyuan-v* release of suyuan2022/OpenMausBot on lizhi-vm and restarts the server.
# Runs on the MacBook: the VM cannot reach GitHub, so the tarball is fetched here with gh and copied over.
#   deploy-vm.sh                 newest release
#   deploy-vm.sh suyuan-v<x>     that release
#   deploy-vm.sh --rollback      whatever was installed before the last deploy
# Add --force to restart even while a bot is working or has queued messages (a restart cuts that short).
set -euo pipefail

REPO=suyuan2022/OpenMausBot
VM=lizhi-vm

force=0 rollback=0 tag=""
for arg; do
  case $arg in
    --force) force=1 ;;
    --rollback) rollback=1 ;;
    *) tag=$arg ;;
  esac
done

target=""
if (( ! rollback )); then
  cache=$(mktemp -d)
  gh release download ${tag:+"$tag"} -R "$REPO" -p '*.tgz' -D "$cache"
  tgz=$(print -r -- "$cache"/*.tgz)
  ssh "$VM" 'mkdir -p ~/.openmausbot-releases'
  scp -q "$tgz" "$VM:.openmausbot-releases/"
  target=.openmausbot-releases/${tgz:t}
  trash "$cache"
fi

ssh "$VM" zsh -s -- "$force" "$rollback" "$target" <<'REMOTE'
set -euo pipefail
force=$1 rollback=$2 target=$3
export PATH="$HOME/.hermes/node/bin:$HOME/.npm-global/bin:$PATH"
LABEL=com.openmausbot.serve
STORE=$HOME/.openmausbot-releases

if (( rollback )); then target=$(cat "$STORE/previous"); else target=$HOME/$target; fi

busy=$(curl -fs http://127.0.0.1:8799/api/bots | node -e '
  const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const names = d.bots.filter(b => b.busy || (b.tasks ?? []).some(t => t.busy)).map(b => b.name);
  const queued = Object.values(d.botQueuedMessages ?? {}).flat().length;
  console.log([...names, ...(queued ? [`${queued} queued message(s)`] : [])].join(", "));
' 2>/dev/null || true)
if [[ -n $busy && $force == 0 ]]; then
  echo "busy: $busy. A restart would cut that work short; rerun later or add --force" >&2
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
curl -fs -o /dev/null http://127.0.0.1:8799/ || { echo "server is not answering on 8799; try: deploy-vm.sh --rollback --force" >&2; exit 1; }
echo "openmausbot $before -> $(openmausbot --version)"
ls -t "$STORE"/*.tgz 2>/dev/null | tail -n +6 | while read -r old; do trash "$old" 2>/dev/null || true; done
REMOTE
