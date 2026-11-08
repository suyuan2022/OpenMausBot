#!/bin/zsh
# Installs a suyuan-v* release of suyuan2022/OpenMausBot on lizhi-vm and restarts the server, never while a bot works.
# Runs on the MacBook: gh fetches the tarball here because the VM's reach to GitHub comes and goes; the install itself
# is deploy-vm-remote.sh, run on the VM, whose output streams back here. It can wait up to 10 minutes for busy bots.
#   deploy-vm.sh                 newest release
#   deploy-vm.sh suyuan-v<x>     that release
#   deploy-vm.sh --rollback      whatever was installed before the last deploy
#   --force                      restart even while a bot works, or reinstall the version already running
set -euo pipefail

VM=lizhi-vm
STORE=.openmausbot-releases
# A link that stops answering drops within a minute instead of hanging the deploy.
ALIVE=(-o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
SSH=(ssh $ALIVE "$VM")
here=${0:A:h}

force=0 rollback=0 tag=""
for arg; do
  case $arg in
    --force) force=1 ;;
    --rollback) rollback=1 ;;
    *) tag=$arg ;;
  esac
done

target=rollback
$SSH "mkdir -p ~/$STORE"
if (( ! rollback )); then
  cache=$(mktemp -d)
  gh release download ${tag:+"$tag"} -R suyuan2022/OpenMausBot -p '*.tgz' -D "$cache"
  tgz=$(print -r -- "$cache"/*.tgz)
  target=$STORE/${tgz:t}
  # The office uplink is slow: a tarball already there from an earlier try is not sent again.
  there=$($SSH "shasum -a 256 ~/$target 2>/dev/null | cut -d' ' -f1" || true)
  if [[ $there != "$(shasum -a 256 "$tgz" | cut -d' ' -f1)" ]]; then
    scp -q $ALIVE "$tgz" "$VM:$target.part"
    $SSH "mv ~/$target.part ~/$target"
  fi
  trash "$cache"
fi
# Copied beside the running one and renamed over it, so a deploy still running keeps reading its own copy.
scp -q $ALIVE "$here/deploy-vm-remote.sh" "$VM:$STORE/deploy-vm-remote.sh.new"
code=0
$SSH "cd ~/$STORE && mv deploy-vm-remote.sh.new deploy-vm-remote.sh && touch deploy.log && start=\$(( \$(wc -c <deploy.log) + 1 ))
  nohup zsh deploy-vm-remote.sh ${(q)force} ${(q)target} </dev/null >>deploy.log 2>&1 & job=\$!
  tail -c +\$start -f deploy.log & tailing=\$!
  wait \$job; code=\$?; sleep 1; kill \$tailing; exit \$code" || code=$?
if (( code == 255 )); then
  echo "lost the connection to $VM; the deploy carries on there. Its output: ssh $VM tail -f ~/$STORE/deploy.log" >&2
fi
exit $code
