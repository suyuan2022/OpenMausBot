#!/bin/zsh
# Installs a suyuan-v* release of suyuan2022/OpenMausBot on lizhi-vm and restarts the server, never while a bot works.
# Runs on the MacBook: gh fetches the tarball here because the VM's reach to GitHub comes and goes; the install itself
# is deploy-vm-remote.sh, run on the VM.
#   deploy-vm.sh                 newest release
#   deploy-vm.sh suyuan-v<x>     that release
#   deploy-vm.sh --rollback      whatever was installed before the last deploy
#   --force                      restart even while a bot works, or reinstall the version already there
set -euo pipefail

VM=lizhi-vm
STORE=.openmausbot-releases
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
ssh "$VM" "mkdir -p ~/$STORE"
if (( ! rollback )); then
  cache=$(mktemp -d)
  gh release download ${tag:+"$tag"} -R suyuan2022/OpenMausBot -p '*.tgz' -D "$cache"
  tgz=$(print -r -- "$cache"/*.tgz)
  scp -q "$tgz" "$VM:$STORE/"
  target=$STORE/${tgz:t}
  trash "$cache"
fi
scp -q "$here/deploy-vm-remote.sh" "$VM:$STORE/deploy-vm-remote.sh"
ssh "$VM" "cd ~/$STORE && nohup zsh deploy-vm-remote.sh ${(q)force} ${(q)target} </dev/null >deploy.log 2>&1; code=\$?; cat deploy.log; exit \$code"
