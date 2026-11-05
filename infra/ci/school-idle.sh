#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
exec "${CI_PYTHON:-$ROOT/vision/.venv/bin/python}" "$ROOT/infra/ci/school_idle.py"
