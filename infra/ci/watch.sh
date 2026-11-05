#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
mode=${1:-check}
case "$mode" in check|deploy) ;; *) echo 'Usage: watch.sh [check|deploy]' >&2; exit 2 ;; esac
STATE=${CI_STATE_DIR:-"${XDG_STATE_HOME:-$HOME/.local/state}/neurovector-ci"}
mkdir -p "$STATE"
exec 8>"$STATE/watch.lock"
flock -n 8 || exit 75
last=''
while true; do
  current=$(infra/ci/source-digest.sh)
  if [[ "$current" != "$last" ]]; then
    sleep "${CI_DEBOUNCE_SECONDS:-15}"
    stable=$(infra/ci/source-digest.sh)
    if [[ "$stable" != "$current" ]]; then continue; fi
    code=0
    infra/ci/run.sh "$mode" || code=$?
    # Retry contention and stale checks; retry failures only after source changes.
    if [[ "$code" != 75 && "$code" != 76 && "$code" != 77 ]]; then last=$current; fi
  fi
  sleep "${CI_POLL_SECONDS:-10}"
done
