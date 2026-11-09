#!/bin/zsh
# Packs the working tree into an npm tarball for deploy-vm.sh, so a change can be tried on the phone before it merges.
# Same assembly as .github/workflows/suyuan-release.yml. The version is the newest release's plus .test.<commit>, so the
# next real release still counts as newer. Prints the tarball's path; the build's output goes to stderr.
set -euo pipefail
cd ${0:A:h}/../..

latest=$(gh release view -R suyuan2022/OpenMausBot --json tagName -q .tagName)
commit=$(git rev-parse --short HEAD)
[[ -n $(git status --porcelain) ]] && commit+=-dirty
version=${latest#suyuan-v}.test.$commit

saved=$(mktemp)
cp package.json "$saved"
trap 'cat "$saved" > package.json; trash "$saved"' EXIT
node -e '
  const fs = require("fs");
  const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
  p.version = process.argv[1];
  fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
' "$version"
{ pnpm build:server && pnpm exec vite build && node scripts/build-npm-package.mjs } >&2
(cd release/npm && npm pack --silent >/dev/null)
print -r -- "$PWD/release/npm/openmausbot-$version.tgz"
