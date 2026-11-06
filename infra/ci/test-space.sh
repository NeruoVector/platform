#!/usr/bin/env bash
# Validate the guard with an isolated df fixture; never fill the real filesystem.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
sandbox=$(mktemp -d /tmp/neurovector-space-test.XXXXXX)
trap 'rm -r "$sandbox"' EXIT
cat > "$sandbox/df" <<'DF'
#!/bin/bash
set -euo pipefail
if [[ ${MOCK_DF_FAILURE:-0} == 1 ]]; then exit 1; fi
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
printf 'fixture 99999999 0 %s 0%% /\n' "${MOCK_FREE_KIB:-4194304}"
DF
chmod +x "$sandbox/df"
for scenario in enough boundary low zero invalid_limit text_limit malformed_df df_failure; do
  free_kib=8388608; minimum=4096; failed_df=0; expected=0
  case "$scenario" in
    boundary) free_kib=4194304 ;;
    low) free_kib=4194303; expected=77 ;;
    zero) free_kib=0; expected=77 ;;
    invalid_limit) minimum=-1; expected=2 ;;
    text_limit) minimum=invalid; expected=2 ;;
    malformed_df) free_kib=unavailable; expected=2 ;;
    df_failure) failed_df=1; expected=2 ;;
  esac
  code=0
  PATH="$sandbox:$PATH" MOCK_FREE_KIB="$free_kib" MOCK_DF_FAILURE="$failed_df" \
    CI_MIN_FREE_MIB="$minimum" "$ROOT/infra/ci/check-space.sh" > "$sandbox/output" 2>&1 || code=$?
  if [[ $code != "$expected" ]]; then
    cat "$sandbox/output" >&2
    echo "Disk preflight regression: $scenario returned $code, expected $expected." >&2
    exit 1
  fi
  echo "Disk preflight: $scenario passed"
done
