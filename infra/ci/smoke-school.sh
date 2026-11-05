#!/usr/bin/env bash
# Read-only HTTP probes; no ICE configuration or response bodies are logged.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
PYTHON=${CI_PYTHON:-"$ROOT/vision/.venv/bin/python"}
base=${CI_SMOKE_BASE_URL:-http://127.0.0.1:18083}
work=$(mktemp -d)
trap 'rm -r "$work"' EXIT
fetch() {
  curl --silent --fail --location --max-redirs 2 --connect-timeout 2 --max-time 5 \
    "$base$1" --output "$work/$2"
}
probe() {
  fetch /healthz health && [[ $(cat "$work/health") == ok ]] &&
  fetch /api-docs/openapi.json openapi &&
  fetch /api/v1/reviews reviews &&
  fetch /swagger-ui/ swagger &&
  "$PYTHON" - "$work" <<'PY'
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
try:
    spec = json.loads((root / "openapi").read_bytes())
    paths = spec["paths"]
    assert "get" in paths["/api/v1/reviews"]
    offer = paths["/api/v1/streams/{drone_id}/whep"]["post"]
    assert "application/sdp" in offer["requestBody"]["content"]
    assert "application/sdp" in offer["responses"]["201"]["content"]
    assert "delete" in paths["/api/v1/streams/{drone_id}/whep/{session_id}"]
    reviews = json.loads((root / "reviews").read_bytes())
    assert isinstance(reviews["items"], list)
    assert type(reviews["total"]) is int and reviews["total"] >= 0
    swagger = (root / "swagger").read_text().lower()
    assert "swagger-ui" in swagger and "swagger-ui-bundle.js" in swagger
except (OSError, UnicodeError, json.JSONDecodeError, KeyError, TypeError, AssertionError):
    sys.exit(1)
PY
}
deadline=$((SECONDS + ${CI_SMOKE_TIMEOUT_SECONDS:-90}))
while (( SECONDS < deadline )); do
  if probe; then echo 'School HTTP smoke checks passed.'; exit 0; fi
  sleep "${CI_SMOKE_RETRY_SECONDS:-3}"
done
echo 'School HTTP smoke checks failed within the bounded startup/DNS retry window.' >&2
exit 1
