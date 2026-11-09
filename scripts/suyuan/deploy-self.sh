#!/bin/zsh
# deploy-vm.sh for a bot that works on lizhi-vm itself (Maus 工程师): the same install by deploy-vm-remote.sh, run in a
# session of its own so the restart it ends with does not end it too. The bot running this is busy until its turn
# ends, and the install waits for every bot to be idle (up to 10 minutes), this one included: end the turn right after.
#   deploy-self.sh                 newest release
#   deploy-self.sh suyuan-v<x>     that release
#   deploy-self.sh path/to/x.tgz   a test build from pack-test.sh
#   deploy-self.sh --rollback      whatever was installed before the last deploy
# No --force: a restart while a bot works would cut its turn short.
set -euo pipefail

STORE=.openmausbot-releases
here=${0:A:h}

rollback=0 tag=""
for arg; do
  case $arg in
    --rollback) rollback=1 ;;
    --force) echo "no --force here: ask 夙愿 to run deploy-vm.sh --force from the MacBook" >&2; exit 1 ;;
    *) tag=$arg ;;
  esac
done

mkdir -p ~/$STORE
target=rollback
if (( ! rollback )); then
  if [[ $tag == *.tgz ]]; then
    [[ -f $tag ]] || { echo "no tarball at $tag" >&2; exit 1; }
    tgz=${tag:A}
    cp "$tgz" ~/$STORE/${tgz:t}
  else
    cache=$(mktemp -d)
    gh release download ${tag:+"$tag"} -R suyuan2022/OpenMausBot -p '*.tgz' -D "$cache"
    tgz=$(print -r -- "$cache"/*.tgz)
    mv "$tgz" ~/$STORE/${tgz:t}
    trash "$cache"
  fi
  target=$STORE/${tgz:t}
fi
# Copied beside the running one and renamed over it, so a deploy still running keeps reading its own copy.
cp "$here/deploy-vm-remote.sh" ~/$STORE/deploy-vm-remote.sh.new
mv ~/$STORE/deploy-vm-remote.sh.new ~/$STORE/deploy-vm-remote.sh
touch ~/$STORE/deploy.log
# Forked twice into a new session: the restart ends the server's processes and their groups, and this is in neither.
python3 -c '
import os, sys
if os.fork(): sys.exit(0)
os.setsid()
if os.fork(): sys.exit(0)
os.chdir(os.path.expanduser("~/.openmausbot-releases"))
log = os.open("deploy.log", os.O_WRONLY | os.O_APPEND)
null = os.open(os.devnull, os.O_RDONLY)
os.dup2(null, 0); os.dup2(log, 1); os.dup2(log, 2)
os.execvp("zsh", ["zsh", "deploy-vm-remote.sh", "0", sys.argv[1]])
' "$target"
echo "the deploy waits in the background until every bot is idle, you included: end this turn now."
echo "after the restart, read the end of ~/$STORE/deploy.log: it ends 'openmausbot <old> -> <new>' when it installed."
