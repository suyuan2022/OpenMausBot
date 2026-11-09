#!/bin/zsh
# Packs the working tree into an npm tarball for deploy-vm.sh, so a change can be tried on the phone before it merges.
# Same steps as .github/workflows/suyuan-release.yml. The version is the newest release's plus .test.g<commit>, so the
# next real release still counts as newer; a tree with uncommitted changes adds the time, so each pack installs anew.
# Prints the tarball's path; the build's output goes to stderr. Takes a few minutes.
set -euo pipefail
cd ${0:A:h}/../..

latest=$(gh release view -R suyuan2022/OpenMausBot --json tagName -q .tagName)
# A tree without the newest release's commits would quietly take its changes off the phone.
git fetch -q origin "refs/tags/$latest:refs/tags/$latest"
git merge-base --is-ancestor "$latest" HEAD || { echo "HEAD lacks $latest: merge suyuan in first" >&2; exit 1; }
# The g keeps a hash of digits only from reading as a number, which semver forbids to start with 0.
commit=g$(git rev-parse --short HEAD)
[[ -n $(git status --porcelain) ]] && commit+=-dirty-$(date +%m%d%H%M%S)
version=${latest#suyuan-v}.test.$commit
tgz=$PWD/release/npm/openmausbot-$version.tgz

saved=$(mktemp)
cp package.json "$saved"
trap 'cat "$saved" > package.json; trash "$saved"' EXIT
# zsh skips the EXIT trap when a signal kills it; exiting on the signal runs it.
trap 'exit 130' INT
trap 'exit 143' TERM HUP
node -e '
  const fs = require("fs");
  const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
  p.version = process.argv[1];
  fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
' "$version"
# One command per line: set -e lets a failure inside an && chain through.
{
  pnpm install --frozen-lockfile
  pnpm build:server
  pnpm exec vite build
  node scripts/build-npm-package.mjs
} >&2
(cd release/npm && npm pack --silent >/dev/null)
[[ -f $tgz ]] || { echo "npm pack made no $tgz" >&2; exit 1; }
print -r -- "$tgz"
