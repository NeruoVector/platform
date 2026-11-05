#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT"
case "${1:-all}" in
  frontend) (cd frontend && npm test && npm run build) ;;
  backend)
    scratch=$(mktemp -d)
    trap 'rm -rf "$scratch"' EXIT
    # Reuse the production dependency/build layers, without modifying its Dockerfile.
    sed '/^FROM .* AS runtime/,$d' backend/Dockerfile > "$scratch/Dockerfile"
    cat >> "$scratch/Dockerfile" <<'DOCKER'
FROM builder AS unit-tests
RUN cargo test --release --locked && touch /ci-passed
FROM scratch AS evidence
COPY --from=unit-tests /ci-passed /ci-passed
DOCKER
    cat > "$scratch/compose.yaml" <<COMPOSE
services:
  tests:
    image: neurovector-ci-backend:local
    build:
      context: "$ROOT/backend"
      dockerfile: "$scratch/Dockerfile"
      target: evidence
COMPOSE
    docker compose -p neurovector-ci -f "$scratch/compose.yaml" build tests
    ;;
  python)
    "$ROOT/infra/ci/test-deploy.sh"
    "$ROOT/infra/ci/test-smoke.sh"
    PYTHON=${CI_PYTHON:-"$ROOT/vision/.venv/bin/python"}
    "$PYTHON" -m pytest vision/tests sim/tests infra/ci/test_school_idle.py
    (cd sim && "$PYTHON" scripts/generate-school-world.py --check)
    ;;
  all)
    "$0" frontend
    "$0" backend
    "$0" python
    ;;
  *) echo "Usage: $0 [all|frontend|backend|python]" >&2; exit 2 ;;
esac
