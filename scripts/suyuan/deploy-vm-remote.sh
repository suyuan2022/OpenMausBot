#!/bin/zsh
# The half of deploy-vm.sh that runs on lizhi-vm. deploy-vm.sh copies it over and runs it under nohup, appending to
# deploy.log, so a dropped ssh never leaves a deploy half done.
#   deploy-vm-remote.sh <force 0|1> <tarball under $HOME | rollback>
set -euo pipefail

force=$1 target=$2
export PATH="$HOME/.hermes/node/bin:$HOME/.npm-global/bin:$PATH"
LABEL=com.openmausbot.serve
STORE=$HOME/.openmausbot-releases

# One deploy at a time; the lock goes with this process, however it ends.
zmodload zsh/system
touch "$STORE/deploy.lock"
zsystem flock -t 0 "$STORE/deploy.lock" 2>/dev/null || { echo "another deploy is still running on the VM; its output is in $STORE/deploy.log" >&2; exit 4; }

# Prints who is working. Exit 0: idle, or no server is listening (nothing to cut short); 1: busy; 2: can't tell.
busy() {
  local answer code=0
  answer=$(curl -fsS -m 10 "http://127.0.0.1:8799/api/bots?messages=0" 2>/dev/null) || code=$?
  (( code == 7 )) && return 0
  (( code != 0 )) && { echo "/api/bots did not answer (curl exit $code)"; return 2; }
  print -r -- "$answer" | node -e '
    try {
      const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
      if (!Array.isArray(d?.bots)) throw new Error("/api/bots changed shape");
      const who = [
        ...d.bots.filter((b) => b.busy || (b.tasks ?? []).some((t) => t.busy)).map((b) => b.name),
        ...(d.groups ?? []).filter((g) => g.working || g.busyBotId || (g.queue ?? []).length).map((g) => `room ${g.name}`),
      ];
      const queued = Object.values(d.botQueuedMessages ?? {}).flat().length;
      if (queued) who.push(`${queued} queued message(s)`);
      if (who.length) { console.log(who.join(", ")); process.exit(10); }
    } catch (error) {
      console.log(error.message);
      process.exit(2);
    }
  ' || return $(( $? == 10 ? 1 : 2 ))
}

answering() { curl -fs -m 5 -o /dev/null http://127.0.0.1:8799/; }

if [[ $target == rollback ]]; then
  target=$(cat "$STORE/previous" 2>/dev/null) || { echo "no earlier install recorded in $STORE/previous" >&2; exit 1; }
else
  target=$HOME/$target
fi
# openmausbot@0.1.148 or .../openmausbot-0.1.149-suyuan.1.tgz -> the version it installs
wanted=${${target:t}#openmausbot[@-]}
wanted=${wanted%.tgz}
before=$(openmausbot --version 2>/dev/null || echo unknown)
if [[ $before == "$wanted" && $force == 0 ]] && answering; then
  echo "already running $wanted; add --force to reinstall it"
  exit 0
fi

# Wait for idle before touching anything: once npm replaces the files, a turn still running would mix two versions.
if (( force == 0 )); then
  for attempt in {1..120}; do
    who=$(busy) && code=0 || code=$?
    (( code == 0 )) && break
    if (( code == 2 )); then
      echo "can't tell whether the bots are idle: $who. Nothing was installed; look, then rerun with --force" >&2
      exit 2
    fi
    (( attempt == 1 )) && echo "waiting until this is done: $who"
    if (( attempt == 120 )); then
      echo "still busy after 10 minutes ($who). Nothing was installed; rerun later" >&2
      exit 3
    fi
    sleep 5
  done
fi

current_spec=$(cat "$STORE/current" 2>/dev/null || echo "openmausbot@$before")
npm install -g "$target" </dev/null
earlier=$(cat "$STORE/previous" 2>/dev/null || true)
# A hand-built test tarball (".test." in its version) is never what --rollback returns to.
[[ $current_spec != "$target" && $current_spec != *.test.* ]] && echo "$current_spec" > "$STORE/previous"
echo "$target" > "$STORE/current"
restart() {
  launchctl kickstart -k "gui/$(id -u)/$LABEL"
  for _ in {1..60}; do
    answering && return 0
    sleep 2
  done
  return 1
}
if ! restart; then
  # A build that never starts leaves no bot to put it back, the one that deployed it from lizhi-vm included.
  back=$(cat "$STORE/previous" 2>/dev/null || true)
  [[ -n $back && $back != "$target" ]] || { echo "server is not answering on 8799; try: deploy-vm.sh --rollback --force" >&2; exit 1; }
  echo "server is not answering on 8799 with ${target:t}; putting back ${back:t}" >&2
  npm install -g "$back" </dev/null
  echo "$back" > "$STORE/current"
  # --rollback goes on meaning the build before this one, as it did before the deploy.
  [[ -n $earlier ]] && echo "$earlier" > "$STORE/previous"
  restart || { echo "${back:t} is not answering either; look at the server's log" >&2; exit 1; }
  echo "openmausbot $before -> $(openmausbot --version): back on ${back:t}, since ${target:t} did not start" >&2
  exit 1
fi
echo "openmausbot $before -> $(openmausbot --version)"
ls -t "$STORE"/*.tgz 2>/dev/null | tail -n +6 | while read -r old; do trash "$old" 2>/dev/null || true; done
