#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -r "$work"' EXIT
mkdir "$work/bin"
cat > "$work/bin/curl" <<'MOCK'
#!/bin/bash
set -euo pipefail
url=''
out=''
while (( $# )); do
  case "$1" in http*) url=$1 ;; --output) shift; out=$1 ;; esac
  shift
done
case "$url" in
  */nv-dash/) echo '<html><script src="/nv-dash/assets/app.js"></script><link rel="stylesheet" href="/nv-dash/assets/app.css"></html>' > "$out" ;;
  */nv-dash/assets/ci-missing-asset.js)
    echo '<html>missing</html>' > "$out"
    if [[ ${MOCK_MISSING_SPA:-0} == 1 ]]; then printf 200; else printf 404; fi ;;
  */nv-dash/assets/app.js|*/nv-dash/assets/app.css)
    [[ ${MOCK_ASSET_FAILURE:-0} != 1 ]] || exit 22
    if [[ ${MOCK_ASSET_SPA:-0} == 1 ]]; then echo '<html>fallback</html>' > "$out"; else echo '/* asset */' > "$out"; fi
    case "$url" in *.js) printf application/javascript ;; *.css) printf text/css ;; esac ;;
  */healthz) echo ok > "$out" ;;
  */openapi.json)
    if [[ ${MOCK_BAD_SCHEMA:-0} == 1 ]]; then echo '{}' > "$out"; else
      echo '{"paths":{"/api/v1/reviews":{"get":{}},"/api/v1/streams/{drone_id}/whep":{"post":{"requestBody":{"content":{"application/sdp":{}}},"responses":{"201":{"content":{"application/sdp":{}}}}}},"/api/v1/streams/{drone_id}/whep/{session_id}":{"delete":{}}}}' > "$out"
    fi ;;
  */reviews) echo '{"items":[],"total":0}' > "$out" ;;
  */swagger-ui/)
    if [[ ${MOCK_SPA:-0} == 1 ]]; then echo '<html><div id="root"></div></html>' > "$out";
    else echo '<html><div id="swagger-ui"></div><script src="swagger-ui-bundle.js"></script></html>' > "$out"; fi ;;
esac
MOCK
chmod +x "$work/bin/curl"
PATH="$work/bin:$PATH" "$ROOT/infra/ci/smoke-school.sh"
if PATH="$work/bin:$PATH" MOCK_SPA=1 CI_SMOKE_TIMEOUT_SECONDS=1 CI_SMOKE_RETRY_SECONDS=0 \
    "$ROOT/infra/ci/smoke-school.sh"; then
  echo 'Smoke regression: SPA masquerading as Swagger was accepted.' >&2; exit 1
fi
if PATH="$work/bin:$PATH" MOCK_BAD_SCHEMA=1 CI_SMOKE_TIMEOUT_SECONDS=1 CI_SMOKE_RETRY_SECONDS=0 \
    "$ROOT/infra/ci/smoke-school.sh"; then
  echo 'Smoke regression: missing API contracts were accepted.' >&2; exit 1
fi
echo 'HTTP smoke mocks: valid contracts accepted; SPA and missing API contracts refused.'

for failure in MOCK_ASSET_FAILURE MOCK_ASSET_SPA MOCK_MISSING_SPA; do
  if env PATH="$work/bin:$PATH" "$failure=1" CI_SMOKE_TIMEOUT_SECONDS=1 CI_SMOKE_RETRY_SECONDS=0 \
      "$ROOT/infra/ci/smoke-school.sh"; then
    echo "Smoke regression: $failure accepted." >&2; exit 1
  fi
done
echo 'Dashboard smoke mocks: unavailable assets, HTML asset fallbacks, and missing-asset fallbacks refused.'
