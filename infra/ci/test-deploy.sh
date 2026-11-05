#!/usr/bin/env bash
# Exercise CD failure handling with isolated fake commands; never contact Docker.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
sandbox=$(mktemp -d /tmp/neurovector-ci-test.XXXXXX)
trap 'rm -r "$sandbox"' EXIT
mkdir -p "$sandbox/infra/ci" "$sandbox/bin"
cp "$ROOT/infra/ci/run.sh" "$sandbox/infra/ci/"
for name in check.sh school-idle.sh check-proxy.sh smoke-school.sh; do
  printf '#!/bin/bash\nexit 0\n' > "$sandbox/infra/ci/$name"
done
cat > "$sandbox/infra/ci/smoke-school.sh" <<'SMOKE'
#!/bin/bash
printf "smoke\n" >> "$CI_STATE_DIR/hooks.log"
[[ "$MOCK_MODE" != smoke_failed || -f "$CI_STATE_DIR/rollback-started" ]]
SMOKE
printf '#!/bin/bash\necho stable\n' > "$sandbox/infra/ci/source-digest.sh"
cat > "$sandbox/bin/docker" <<'MOCK'
#!/bin/bash
set -euo pipefail
printf '%s\n' "$*" >> "$CI_STATE_DIR/docker.log"
case "$*" in
  'inspect '*) printf 'sha256:%064d\n' 1 ;;
  *'ps -q backend') echo backend-container ;;
  *'ps -q frontend') echo frontend-container ;;
  *'run --rm --no-deps migrate')
    [[ "$MOCK_MODE" != migration_failed ]] ;;
  'exec nv-frontend nginx -s reload')
    [[ "$MOCK_MODE" != reload_failed || -f "$CI_STATE_DIR/rollback-started" ]] ;;
  *' up -d '*)
    if [[ "$*" == *'rollback.'* ]]; then
      touch "$CI_STATE_DIR/rollback-started"
      [[ "$MOCK_MODE" != rollback_failed ]]
    else
      [[ "$MOCK_MODE" == deployed || "$MOCK_MODE" == reload_failed || "$MOCK_MODE" == smoke_failed ]]
    fi ;;
esac
MOCK
chmod +x "$sandbox/infra/ci/"*.sh "$sandbox/bin/docker"
for scenario in migration_failed rolled_back rollback_failed deployed reload_failed smoke_failed; do
  expected=$scenario
  case "$scenario" in reload_failed|smoke_failed) expected=rolled_back ;; esac
  mkdir -p "$sandbox/$scenario"
  code=0
  PATH="$sandbox/bin:$PATH" CI_STATE_DIR="$sandbox/$scenario" MOCK_MODE="$scenario" \
    CI_DEPLOY_IDLE_CHECK="$sandbox/infra/ci/school-idle.sh" \
    CI_DEPLOY_PROXY_CHECK="$sandbox/infra/ci/check-proxy.sh" \
    CI_DEPLOY_SMOKE_CHECK="$sandbox/infra/ci/smoke-school.sh" \
    "$sandbox/infra/ci/run.sh" deploy > "$sandbox/$scenario/output.log" 2>&1 || code=$?
  result="$sandbox/$scenario/result.json"
  calls="$sandbox/$scenario/docker.log"
  grep -Eq '"status":"'"$expected"'"' "$result"
  if [[ "$expected" == deployed ]]; then test "$code" = 0; else test "$code" != 0; fi
  if [[ "$expected" == migration_failed ]]; then
    ! grep -Eq ' up -d ' "$calls"
  else
    grep -Eq 'run --rm --no-deps migrate' "$calls"
    # Migration must precede the first replacement call.
    awk '/run --rm --no-deps migrate/ {m=1} / up -d / && !m {exit 1}' "$calls"
    if [[ "$expected" != deployed ]]; then
      grep -Eq 'rollback.*--force-recreate.*backend frontend' "$calls"
      grep -Eq 'image: neurovector-ci-backend-rollback:' "$sandbox/$scenario/"rollback.*/compose.yaml
      grep -Eq 'image: neurovector-ci-frontend-rollback:' "$sandbox/$scenario/"rollback.*/compose.yaml
    fi
  fi
  ! grep -Eq ' (down|restart|sim)( |$)|--volumes' "$calls"
  echo "CD mock: $scenario -> $expected passed"
done
