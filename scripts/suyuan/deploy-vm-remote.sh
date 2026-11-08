#!/bin/zsh
# The half of deploy-vm.sh that runs on lizhi-vm. deploy-vm.sh copies it over and runs it under nohup with its output in
# a file, so a dropped ssh never leaves a deploy half done.
#   deploy-vm-remote.sh <force 0|1> <tarball under $HOME | rollback>
set -euo pipefail

force=$1 target=$2
export PATH="$HOME/.hermes/node/bin:$HOME/.npm-global/bin:$PATH"
LABEL=com.openmausbot.serve
STORE=$HOME/.openmausbot-releases

# Prints who is working. Exit 0: idle, or no server is listening (nothing to cut short); 1: busy; 2: can't tell.
busy() {
  local answer code=0
  answer=$(curl -fsS -m 10 "http://127.0.0.1:8799/api/bots?messages=0" 2>/dev/null) || code=$?
  (( code == 7 )) && return 0
  (( code != 0 )) && { echo "/api/bots did not answer (curl exit $code)"; return 2; }
  print -r -- "$answer" | node -e '
    const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
    if (!Array.isArray(d.bots)) { console.log("/api/bots changed shape"); process.exit(2); }
    const who = [
      ...d.bots.filter((b) => b.busy || (b.tasks ?? []).some((t) => t.busy)).map((b) => b.name),
      ...(d.groups ?? []).filter((g) => g.working || g.busyBotId || (g.queue ?? []).length).map((g) => `room ${g.name}`),
    ];
    const queued = Object.values(d.botQueuedMessages ?? {}).flat().length;
    if (queued) who.push(`${queued} queued message(s)`);
    if (who.length) { console.log(who.join(", ")); process.exit(1); }
  ' || return $(( $? == 1 ? 1 : 2 ))
}

if [[ $target == rollback ]]; then
  target=$(cat "$STORE/previous" 2>/dev/null) || { echo "no earlier install recorded in $STORE/previous" >&2; exit 1; }
else
  target=$HOME/$target
fi
before=$(openmausbot --version)
current_spec=$(cat "$STORE/current" 2>/dev/null || echo "openmausbot@$before")
if [[ $target == "$current_spec" && $force == 0 ]]; then
  echo "already on $target ($before); add --force to reinstall it"
  exit 0
fi

who=$(busy) && code=0 || code=$?
if (( code != 0 && force == 0 )); then
  if (( code == 1 )); then echo "busy: $who. A restart would cut that short; rerun later or add --force" >&2
  else echo "can't tell whether the bots are idle: $who. Look, then rerun with --force" >&2; fi
  exit 2
fi

npm install -g "$target" </dev/null
[[ $current_spec != "$target" ]] && echo "$current_spec" > "$STORE/previous"
echo "$target" > "$STORE/current"

# The install took a while, and someone may have started something since the first look.
if (( force == 0 )); then
  for attempt in {1..120}; do
    who=$(busy) && code=0 || code=$?
    (( code == 0 )) && break
    (( attempt == 1 )) && echo "installed; waiting to restart until this is done: $who"
    if (( attempt == 120 )); then
      echo "installed $target but still busy after 10 minutes ($who), so the server was not restarted; rerun with --force" >&2
      exit 3
    fi
    sleep 5
  done
fi

launchctl kickstart -k "gui/$(id -u)/$LABEL"
for _ in {1..60}; do
  curl -fs -m 5 -o /dev/null http://127.0.0.1:8799/ && break
  sleep 2
done
curl -fs -m 5 -o /dev/null http://127.0.0.1:8799/ || { echo "server is not answering on 8799; try: deploy-vm.sh --rollback --force" >&2; exit 1; }
echo "openmausbot $before -> $(openmausbot --version)"
ls -t "$STORE"/*.tgz 2>/dev/null | tail -n +6 | while read -r old; do trash "$old" 2>/dev/null || true; done
