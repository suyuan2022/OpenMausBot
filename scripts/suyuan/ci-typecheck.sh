#!/usr/bin/env bash
# CI's typecheck: the two projects `pnpm typecheck` checks (tsconfig.json, tsconfig.server.json), side by side, each
# incremental. tsc keeps a content hash and the diagnostics of every file in its .tsbuildinfo and rechecks only the files
# that changed and the ones they affect, so with the file restored from a cache it reports what a run from scratch
# reports. (Checked before this went in: renamed exports, a changed global declaration, a deleted file, a new file with an
# error, with the sources dated older than the restored file; each gave the same errors as a run from scratch, and no stale
# error once undone.) `pnpm typecheck` uses tsc -b, which rechecks every file every time here: tsconfig.json does not set
# "incremental".
# The workflows cache node_modules/.cache/suyuan-tsc; locally this works without it and leaves the files there.
set -uo pipefail
cd "$(dirname "$0")/../.."
dir=node_modules/.cache/suyuan-tsc
mkdir -p "$dir"

check() { # name, tsconfig
  node_modules/.bin/tsc -p "$2" --incremental --tsBuildInfoFile "$dir/$1.tsbuildinfo" >"$dir/$1.log" 2>&1
}

check web tsconfig.json &
web=$!
check server tsconfig.server.json &
server=$!
wait "$web"
web_exit=$?
wait "$server"
server_exit=$?

cat "$dir/web.log" "$dir/server.log"
echo "tsconfig.json: exit $web_exit · tsconfig.server.json: exit $server_exit"
[ "$web_exit" -eq 0 ] && [ "$server_exit" -eq 0 ]
