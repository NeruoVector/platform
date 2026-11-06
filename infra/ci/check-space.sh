#!/usr/bin/env bash
# Read-only preflight for the filesystem holding this workspace/build context.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
minimum=${CI_MIN_FREE_MIB:-4096}
path=${CI_DISK_PATH:-$ROOT}
if [[ ! $minimum =~ ^[1-9][0-9]{0,8}$ ]]; then
  echo 'CI_MIN_FREE_MIB must be a positive integer in MiB.' >&2
  exit 2
fi
if ! free_kib=$(df -Pk -- "$path" | awk 'NR == 2 { print $4 }'); then
  echo "Cannot check free disk space for $path; build refused." >&2
  exit 2
fi
if [[ ! $free_kib =~ ^(0|[1-9][0-9]{0,14})$ ]]; then
  echo "Invalid free-space result for $path; build refused." >&2
  exit 2
fi
if (( free_kib < minimum * 1024 )); then
  printf 'Build deferred: %s has %s MiB free; at least %s MiB required. No files were removed.\n' \
    "$path" "$((free_kib / 1024))" "$minimum" >&2
  exit 77
fi
printf 'Disk preflight: %s MiB free; minimum %s MiB.\n' "$((free_kib / 1024))" "$minimum"
