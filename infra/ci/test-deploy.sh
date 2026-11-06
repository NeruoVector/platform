#!/usr/bin/env bash
# Exercise CD failure handling with isolated fake commands; never contact Docker.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
sandbox=$(mktemp -d /tmp/neurovector-ci-test.XXXXXX)
trap 'rm -r "$sandbox"' EXIT
mkdir -p "$sandbox/infra/ci" "$sandbox/bin"
cp "$ROOT/infra/ci/run.sh" "$sandbox/infra/ci/"
for name in check.sh check-space.sh school-idle.sh check-proxy.sh smoke-school.sh; do
  printf '#!/bin/bash\nexit 0\n' > "$sandbox/infra/ci/$name"
done
cat > "$sandbox/infra/ci/check-space.sh" <<'SPACE'
#!/bin/bash
set -euo pipefail
if [[ $MOCK_MODE == low_disk ]]; then exit 77; fi
if [[ $MOCK_MODE == low_disk_after_checks ]]; then
  count=0
  if [[ -f $CI_STATE_DIR/space.calls ]]; then read -r count < "$CI_STATE_DIR/space.calls"; fi
  count=$((count + 1))
  printf '%s\n' "$count" > "$CI_STATE_DIR/space.calls"
  if (( count > 1 )); then exit 77; fi
fi
SPACE
cat > "$sandbox/infra/ci/smoke-school.sh" <<'SMOKE'
#!/bin/bash
printf "smoke\n" >> "$CI_STATE_DIR/hooks.log"
if [[ -f "$CI_STATE_DIR/rollback-started" && $MOCK_MODE == first_* ]]; then
  [[ ${CI_SMOKE_DASHBOARD:-1} == 0 ]] || exit 1
fi
[[ "$MOCK_MODE" != smoke_failed && "$MOCK_MODE" != first_smoke_failed || -f "$CI_STATE_DIR/rollback-started" ]]
SMOKE
printf '#!/bin/bash\necho stable\n' > "$sandbox/infra/ci/source-digest.sh"
cat > "$sandbox/bin/docker" <<'MOCK'
#!/bin/bash
set -euo pipefail
printf '%s\n' "$*" >> "$CI_STATE_DIR/docker.log"
case "$*" in
  'image tag '*) printf '%s %s\n' "$4" "$3" >> "$CI_STATE_DIR/tags" ;;
  *'rm -s -f dashboard') rm -f "$CI_STATE_DIR/dashboard.image" ;;
  'inspect '*)
    case "$*" in *backend-container) id=1 ;; *frontend-container) id=2 ;; *dashboard-container) id=3 ;; *) exit 1 ;; esac
    printf 'sha256:%064d\n' "$id" ;;
  *'ps -q backend') echo backend-container ;;
  *'ps -q frontend') echo frontend-container ;;
  *'ps -q dashboard') if [[ $MOCK_MODE != first_* ]]; then echo dashboard-container; fi ;;
  *'run --rm --no-deps migrate')
    [[ "$MOCK_MODE" != migration_failed ]] ;;
  'exec nv-frontend nginx -s reload')
    [[ "$MOCK_MODE" != reload_failed || -f "$CI_STATE_DIR/rollback-started" ]] ;;
  *' up -d '*)
    if [[ "$*" == *'rollback.'* ]]; then
      touch "$CI_STATE_DIR/rollback-started"
      [[ "$MOCK_MODE" != rollback_failed ]] || exit 1
      override=''
      while (( $# )); do
        if [[ $1 == -f ]]; then shift; override=$1; fi
        shift
      done
      service=''
      while read -r key value; do
        case "$key" in
          backend:|frontend:|dashboard:) service=${key%:} ;;
          image:)
            image=$(awk -v tag="$value" '$1 == tag { print $2 }' "$CI_STATE_DIR/tags")
            [[ -n $image ]] || exit 1
            printf '%s\n' "$image" > "$CI_STATE_DIR/$service.image" ;;
        esac
      done < "$override"
    else
      for service in backend frontend dashboard; do
        printf 'candidate\n' > "$CI_STATE_DIR/$service.image"
      done
      [[ "$MOCK_MODE" == deployed || "$MOCK_MODE" == reload_failed || "$MOCK_MODE" == smoke_failed || "$MOCK_MODE" == first_smoke_failed || "$MOCK_MODE" == first_deployed ]]
    fi ;;
esac
MOCK
chmod +x "$sandbox/infra/ci/"*.sh "$sandbox/bin/docker"
for scenario in low_disk low_disk_after_checks migration_failed rolled_back rollback_failed deployed reload_failed smoke_failed first_deployed first_smoke_failed; do
  expected=$scenario
  case "$scenario" in
    low_disk|low_disk_after_checks) expected=deferred ;;
    reload_failed|smoke_failed|first_smoke_failed) expected=rolled_back ;;
    first_deployed) expected=deployed ;;
  esac
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
  if [[ $expected == deferred ]]; then
    test "$code" = 77
    test ! -e "$calls"
    echo "CD mock: $scenario -> deferred before Docker passed"
    continue
  fi
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
      for entry in backend:1 frontend:2 dashboard:3; do
        service=${entry%:*}; id=${entry#*:}
        if [[ $scenario == first_* && $service == dashboard ]]; then continue; fi
        image=$(printf 'sha256:%064d' "$id")
        grep -F "image tag $image neurovector-ci-$service-rollback:" "$calls" > /dev/null
      done
      if [[ $expected == rolled_back ]]; then
        for entry in backend:1 frontend:2 dashboard:3; do
          service=${entry%:*}; id=${entry#*:}
          if [[ $scenario == first_* && $service == dashboard ]]; then
            test ! -e "$sandbox/$scenario/dashboard.image"
          else
            test "$(cat "$sandbox/$scenario/$service.image")" = "$(printf 'sha256:%064d' "$id")"
          fi
        done
      fi
      if [[ $scenario == first_* ]]; then
        grep -Eq 'rm -s -f dashboard$' "$calls"
        ! grep -Eq 'rollback.*--force-recreate.*dashboard' "$calls"
      else
        grep -Eq 'rollback.*--force-recreate.*backend frontend dashboard$' "$calls"
      fi
    fi
  fi
  ! grep -Eq ' (down|restart|sim)( |$)|--volumes' "$calls"
  echo "CD mock: $scenario -> $expected passed"
done
