#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
# Hash inputs rather than Git pointers: dirty submodule changes count too.
find frontend backend vision sim drone monitoring infra .github \
  -type d \( -name .git -o -name node_modules -o -name .venv -o -name __pycache__ -o -name .pytest_cache -o -name .ruff_cache -o -name target -o -name dist -o -name build -o -name logs -o -name models -o -name .cache \) -prune -o \
  -type f ! -name '.env*' ! -name '*.pyc' ! -name '*.tsbuildinfo' ! -name '*.pt' ! -name '*.onnx' ! -name '*.mp4' ! -name '*.log' -print0 \
  | { cat; find . -maxdepth 1 -type f \( -name 'compose*.yaml' -o -name Makefile -o -name .gitmodules \) -print0; } \
  | LC_ALL=C sort -z | xargs -0 -r sha256sum -- | sha256sum | cut -d ' ' -f 1
