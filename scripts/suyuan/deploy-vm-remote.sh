#!/bin/zsh
# The half of deploy-vm.sh that runs on lizhi-vm. deploy-vm.sh copies it over and runs it under nohup, appending to
# deploy.log, so a dropped ssh never leaves a deploy half done.
#   deploy-vm-remote.sh <force 0|1> <tarball under $HOME | rollback>
# Bots still busy after 10 minutes: this exits 3 as before, and leaves a copy of itself behind that goes on waiting for
# idle (12 hours at most) and installs then. Nobody's turn is cut short, and nobody has to remember to rerun it.
set -euo pipefail

force=$1 target=$2
export PATH="$HOME/.hermes/node/bin:$HOME/.npm-global/bin:$PATH"
LABEL=com.openmausbot.serve
STORE=$HOME/.openmausbot-releases

# The copy left waiting (see the top): set to the time it stops trying. It writes to deploy.log whoever started it.
retry_until=${OMB_DEPLOY_RETRY_UNTIL:-}
RETRY_PID=$STORE/retry.pid

# One deploy at a time; the lock goes with this process, however it ends. The waiting copy takes it only once the bots
# are idle, so a newer deploy is never turned away by an older one that is still waiting.
zmodload zsh/system zsh/datetime
touch "$STORE/deploy.lock"
lock() { zsystem flock -t 0 "$STORE/deploy.lock" 2>/dev/null; }
if [[ -z $retry_until ]]; then
  lock || { echo "another deploy is still running on the VM; its output is in $STORE/deploy.log" >&2; exit 4; }
  # This deploy replaces whatever an earlier one is still waiting to install.
  waiting=$(cat "$RETRY_PID" 2>/dev/null || true)
  if [[ $waiting == <-> && $(ps -p $waiting -o command= 2>/dev/null) == *deploy-vm-remote.sh* ]]; then
    kill $waiting 2>/dev/null && echo "stopped the earlier deploy that was still waiting for idle; this one replaces it"
  fi
  rm -f "$RETRY_PID"
else
  # The deploy that left this copy behind wrote its pid to $RETRY_PID before letting go of the lock, so no newer deploy
  # can miss it. Without that entry this copy has been replaced, and the loop below ends it.
  for _ in {1..50}; do
    [[ $(cat "$RETRY_PID" 2>/dev/null) == $$ ]] && break
    sleep 0.1
  done
fi

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
# A restart ends every bot's turn, Maus 工程师's own when it deployed from lizhi-vm, and nothing would bring it back to check
# the install and tell 夙愿. So a finished install calls its automation, whose private address is kept in this file, outside
# the repository. The service's webhook port may come up a moment after 8799. A deploy that gave up without installing
# calls it too (outcome not-installed), or nobody learns the new version never went in.
#   wake_engineer installed | rolled-back | not-installed
wake_engineer() {
  [[ -r $STORE/wake-hook ]] || return 0
  local hook=$(<"$STORE/wake-hook") outcome=$1
  for _ in {1..${WAKE_TRIES:-15}}; do
    curl -fsS -m 10 -o /dev/null -X POST -H 'content-type: application/json' -d "{\"outcome\":\"$outcome\",\"installed\":\"$(openmausbot --version 2>/dev/null)\"}" "$hook" 2>/dev/null && return 0
    sleep 2
  done
  echo "could not reach Maus 工程师's after-install automation" >&2
}

# The MacBook's MausBot Safari web app keeps the page it loaded and Cmd+Q does not always close it (11-26), so a new
# build reaches it only when it is closed and opened again. $STORE/desk-app-host names the ssh host; the app opens behind
# the windows in front, and is left alone when it was not running.
reopen_desk_app() {
  [[ -r $STORE/desk-app-host ]] || return 0
  ssh -o ConnectTimeout=5 -o BatchMode=yes "$(<"$STORE/desk-app-host")" '
    app="$HOME/Applications/MausBot Safari.app"; mark="bundlepath $app"
    pgrep -f "$mark" >/dev/null || exit 0
    pkill -f "$mark"; for _ in 1 2 3 4 5; do pgrep -f "$mark" >/dev/null || break; sleep 1; done
    pkill -9 -f "$mark"; sleep 1; open -g "$app"' </dev/null \
    && echo "reopened MausBot Safari on the MacBook" || echo "could not reopen MausBot Safari on the MacBook" >&2
}

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
if [[ -n $retry_until ]]; then
  # The waiting copy. It says nothing until it installs or stops: each wake_engineer is a turn of a busy bot.
  calm=0
  while true; do
    if [[ $(cat "$RETRY_PID" 2>/dev/null) != $$ ]]; then exit 0; fi  # a newer deploy took over
    if [[ $(openmausbot --version 2>/dev/null) == "$wanted" ]] && answering; then rm -f "$RETRY_PID"; exit 0; fi
    who=$(busy) && code=0 || code=$?
    # Idle twice in a row, with the server answering: one turn ending just before the next starts is not idle, and a
    # server that is down is somebody else's restart, not a moment to change the files under it.
    if (( code == 0 )) && answering; then
      if (( ++calm >= 2 )); then
        lock && break
        echo "another deploy is running; the one waiting to install ${target:t} stops here"
        rm -f "$RETRY_PID"
        exit 0
      fi
    else
      calm=0
    fi
    if (( EPOCHSECONDS >= retry_until )); then
      echo "still busy at $(strftime %H:%M $EPOCHSECONDS) ($who). Gave up; nothing was installed, rerun later" >&2
      rm -f "$RETRY_PID"
      wake_engineer not-installed
      exit 3
    fi
    sleep ${WAIT_SECONDS:-5}
  done
  rm -f "$RETRY_PID"
  echo "the bots are idle at $(strftime %H:%M $EPOCHSECONDS); installing ${target:t}"
elif (( force == 0 )); then
  for attempt in {1..${WAIT_TRIES:-120}}; do
    who=$(busy) && code=0 || code=$?
    (( code == 0 )) && break
    if (( code == 2 )); then
      echo "can't tell whether the bots are idle: $who. Nothing was installed; look, then rerun with --force" >&2
      wake_engineer not-installed
      exit 2
    fi
    (( attempt == 1 )) && echo "waiting until this is done: $who"
    if (( attempt == ${WAIT_TRIES:-120} )); then
      until=$(( EPOCHSECONDS + ${RETRY_FOR:-43200} ))
      echo "still busy after 10 minutes ($who). Nothing is installed yet; it goes on waiting in the background and installs once every bot is idle, until $(strftime %H:%M $until) at the latest" >&2
      OMB_DEPLOY_RETRY_UNTIL=$until zsh ${0:A} 0 "$2" </dev/null >>"$STORE/deploy.log" 2>&1 &!
      echo $! > "$RETRY_PID"
      exit 3
    fi
    sleep ${WAIT_SECONDS:-5}
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
  reopen_desk_app
  wake_engineer rolled-back
  exit 1
fi
echo "openmausbot $before -> $(openmausbot --version)"
reopen_desk_app
wake_engineer installed
ls -t "$STORE"/*.tgz 2>/dev/null | tail -n +6 | while read -r old; do trash "$old" 2>/dev/null || true; done
