#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT"
STATE=${CI_STATE_DIR:-"${XDG_STATE_HOME:-$HOME/.local/state}/neurovector-ci"}
mkdir -p "$STATE"
exec 9>"$STATE/run.lock"
flock -n 9 || exit 75
mode=${1:-check}
case "$mode" in check|deploy) ;; *) echo 'Usage: run.sh [check|deploy]' >&2; exit 2 ;; esac
before=$(infra/ci/source-digest.sh)
started=$(date -u +%FT%TZ)
log="$STATE/$(date -u +%Y%m%dT%H%M%S)-$before.log"
status=failed
finish() {
  code=$?
  printf '{"started":"%s","digest":"%s","status":"%s","exit_code":%d,"log":"%s"}\n' \
    "$started" "$before" "$status" "$code" "$log" > "$STATE/result.json.tmp"
  mv "$STATE/result.json.tmp" "$STATE/result.json"
}
trap finish EXIT
exec > >(tee -a "$log") 2>&1
infra/ci/check.sh
if [[ $(infra/ci/source-digest.sh) != "$before" ]]; then
  status=stale
  echo 'Source changed during checks; deployment refused.'
  exit 76
fi
if [[ "$mode" == deploy ]]; then
  CI_DEPLOY_IDLE_CHECK=${CI_DEPLOY_IDLE_CHECK:-"$ROOT/infra/ci/school-idle.sh"}
  if [[ -z ${CI_DEPLOY_IDLE_CHECK:-} || ! -x ${CI_DEPLOY_IDLE_CHECK:-} ]]; then
    status=deferred
    echo "Deployment deferred: CI_DEPLOY_IDLE_CHECK must name an executable flight-idle guard."
    exit 77
  fi
  if ! "$CI_DEPLOY_IDLE_CHECK"; then
    status=deferred
    echo "Deployment deferred: flight is not confirmed idle."
    exit 77
  fi
  # Deliberately scoped to app services: never restart the flight simulator.
  compose=(docker compose --profile sim -f compose.yaml -f "$HOME/.config/neurovector/compose.yaml" -f compose.school.yaml)
  "${compose[@]}" config --quiet
  CI_DEPLOY_PROXY_CHECK=${CI_DEPLOY_PROXY_CHECK:-"$ROOT/infra/ci/check-proxy.sh"}
  CI_DEPLOY_SMOKE_CHECK=${CI_DEPLOY_SMOKE_CHECK:-"$ROOT/infra/ci/smoke-school.sh"}
  "$CI_DEPLOY_PROXY_CHECK"
  # Pin the exact running images before build moves their mutable deployment tags.
  rollback_dir=$(mktemp -d "$STATE/rollback.XXXXXX")
  rollback_file="$rollback_dir/compose.yaml"
  printf 'services:\n' > "$rollback_file"
  for service in backend frontend; do
    container=$("${compose[@]}" ps -q "$service")
    if [[ -z "$container" ]]; then
      echo "Cannot prepare rollback: $service has no existing container."
      exit 1
    fi
    image=$(docker inspect --format '{{.Image}}' "$container")
    if [[ ! "$image" =~ ^sha256:[a-f0-9]{64}$ ]]; then
      echo "Cannot prepare rollback: invalid image ID for $service."
      exit 1
    fi
    tag="neurovector-ci-$service-rollback:$(basename "$rollback_dir")"
    docker image tag "$image" "$tag"
    printf '  %s:\n    image: %s\n' "$service" "$tag" >> "$rollback_file"
  done
  "${compose[@]}" build backend frontend
  if [[ $(infra/ci/source-digest.sh) != "$before" ]]; then
    status=stale
    echo 'Source changed during image build; deployment refused.'
    exit 76
  fi
  if ! "$CI_DEPLOY_IDLE_CHECK"; then
    status=deferred
    echo "Deployment deferred: flight is no longer confirmed idle."
    exit 77
  fi
  # Run the canonical one-shot job without replacing the existing application.
  if ! "${compose[@]}" run --rm --no-deps migrate; then
    status=migration_failed
    echo 'Migration failed; existing app containers were not replaced.'
    exit 1
  fi
  if [[ $(infra/ci/source-digest.sh) != "$before" ]]; then
    status=stale
    echo 'Source changed during migration; app replacement refused.'
    exit 76
  fi
  if ! "$CI_DEPLOY_IDLE_CHECK"; then
    status=deferred
    echo 'Flight is no longer idle after migration; app replacement deferred.'
    exit 77
  fi
  if "${compose[@]}" up -d --no-deps --no-build --pull never --wait --wait-timeout 90 backend frontend \
      && docker exec nv-frontend nginx -s reload \
      && "$CI_DEPLOY_PROXY_CHECK" \
      && "$CI_DEPLOY_SMOKE_CHECK"; then
    status=deployed
  else
    echo "App health validation failed; restoring images from $rollback_file"
    if "${compose[@]}" -f "$rollback_file" up -d --no-deps --no-build --pull never \
        --force-recreate --wait --wait-timeout 90 backend frontend \
        && docker exec nv-frontend nginx -s reload \
      && "$CI_DEPLOY_PROXY_CHECK" \
      && "$CI_DEPLOY_SMOKE_CHECK"; then
      status=rolled_back
      echo 'Prior app images restored. Database migrations are preserved.'
    else
      status=rollback_failed
      echo "Rollback failed; inspect app health and retry with override $rollback_file" >&2
    fi
    exit 1
  fi
else
  status=passed
fi
printf '%s\n' "$before" > "$STATE/last-passed-digest"
