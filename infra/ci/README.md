# Continuous checks and local app deployment

All commands run from the repository root. No service is enabled by adding these files.

## Shared checks

Initialize the existing submodules first. Install frontend dependencies with `npm ci --prefix frontend` and `npm ci --prefix nv-dash`; prepare Python with `uv sync --project vision --locked --group dev --python 3.14` (no Torch/model download). Existing `vision/.venv` is reused locally. Docker Engine and Compose are required for Rust checks.

```sh
infra/ci/check.sh                 # all suites, fail immediately on failure
infra/ci/check.sh frontend        # node tests + TypeScript/Vite production build
infra/ci/check.sh dashboard       # dashboard tests (when present), lint, /nv-dash/ production build
infra/ci/check.sh backend         # full Rust unit tests, production Docker builder cache
infra/ci/check.sh python          # vision + simulator pytest, static school world validation
infra/ci/run.sh check             # same checks with lock, source digest and result log
```

`CI_PYTHON` overrides the Python executable. Backend tests create only an evidence image (`neurovector-ci-backend:local`); they start no app, database or simulator containers. The Dockerfile builder stage and its dependency cache are reused; first-time hosted builds can be slow. Python checks test inference using test doubles; GPU inference, ROS/SITL integration, browser/media connectivity, and live flight checks remain separate operational checks.

`.github/workflows/ci.yaml` runs the same suites on GitHub-hosted runners for pushes, pull requests and manual runs. It has read-only repository permission and never contacts a production host. It becomes active only after publishing this workflow and the referenced submodule commits. Unpushed changes inside submodules are tested locally but are not available to remote CI. Private submodules require a separately configured read-only checkout credential; do not use a deployment credential.

## Continuous local review

The watcher performs an initial check, waits 15 seconds for edits to settle, then checks every changed source digest. It polls every 10 seconds and runs only one check at a time. Failed digests retry after another edit; interrupted runs are retried after service restart. Changes during checks are marked stale and retried. Results are in `~/.local/state/neurovector-ci/result.json`, alongside timestamped logs; inspect these or `journalctl --user -u neurovector-ci -f`. `CI_STATE_DIR`, `CI_DEBOUNCE_SECONDS`, and `CI_POLL_SECONDS` can override defaults.

Digest inputs include dirty submodule files and compose/CI configuration. Git metadata, secrets (`.env*`), runtime state, dependency/build/cache directories, model directories, model weights and video assets are excluded. Asset/model-only changes require explicit operational validation; this watcher does not certify model quality. It never pulls, resets, commits, pushes, changes secrets, or prunes Docker caches/volumes.

Review the template, then activate explicitly:

```sh
mkdir -p ~/.config/systemd/user
sed "s|@WORKSPACE@|$(pwd)|g" infra/ci/neurovector-ci.service.in > ~/.config/systemd/user/neurovector-ci.service
systemctl --user daemon-reload
systemctl --user enable --now neurovector-ci.service
```

Run `systemctl --user disable --now neurovector-ci.service` to stop watching. User services persist after logout only when the host already permits lingering (`loginctl show-user "$USER" -p Linger`); the template does not change host policy. A workspace path containing spaces needs systemd argument quoting in the rendered unit.

## Optional local CD

```sh
infra/ci/run.sh deploy
```

This runs all checks and refuses deployment unless the source digest remains unchanged. It validates and builds with `compose.yaml`, `~/.config/neurovector/compose.yaml`, and `compose.school.yaml`, then rechecks the digest before `up -d --no-deps --no-build --wait backend frontend dashboard`. Builds complete before replacing running app containers. Existing volumes and secret files are preserved. Before replacement, CD pins the running backend/frontend/dashboard image IDs under unique rollback tags and runs the canonical `migrate` job with `run --rm --no-deps`. Migration failure leaves existing app containers running. Failed replacement health checks or post-deploy Nginx validation trigger app-image rollback using the recorded Compose override; JSON distinguishes `migration_failed`, `rolled_back`, and `rollback_failed`.

Deployment is deliberately limited to backend/frontend/dashboard: the simulator, vision service, media services, monitoring static files and infrastructure are never restarted by this command. A simulator or flight-stack change must be deployed separately only after confirming the vehicle is disarmed and idle. Keep the watcher in `check` mode for flight sessions. To opt into continuous app CD after review, change the rendered unit's final `check` argument to `deploy`, then reload/restart that unit. This does not deploy simulator changes and is not a zero-downtime release system.

CD uses the built-in idle guard by default. An override through `CI_DEPLOY_IDLE_CHECK` must name an executable guard. It must return zero only when fresh authoritative telemetry confirms the vehicle is disarmed and idle; unavailable/stale telemetry must return nonzero. The guard runs before the image build and again immediately before replacement. Missing/failed guards defer deployment (exit 77), and the watcher retries later. For a deploy-mode user service, set this variable with an `Environment=` entry. A generic CI script cannot infer flight safety from a successful build or an old status file; do not substitute an unconditional success command.

The built-in default idle guard is `$WORKSPACE/infra/ci/school-idle.sh` (absolute path resolved by `run.sh`). It reuses `vision/.venv/bin/python` (`CI_PYTHON` overrides) and parses `runtime/school/state.json` with strict JSON field types. It requires a finite timestamp aged 0–5 seconds, boolean `armed=false`, null `order_id`, and mode `waiting_for_order` or `order_completed`. Missing, stale, malformed, flying, hold, or active-order state blocks deployment. Direct validation: `infra/ci/school-idle.sh`. To replace it, set `CI_DEPLOY_IDLE_CHECK` to an absolute executable path with equivalent fail-closed semantics.

The default proxy hook is `$WORKSPACE/infra/ci/check-proxy.sh`, which runs read-only `docker exec nv-frontend nginx -t` before build and after replacement/rollback. `CI_DEPLOY_PROXY_CHECK=/absolute/executable` overrides it. Pre-build hook failure stops deployment. Check-only mode does not require a running proxy; the watcher template remains check-only. See `proxy.md` for the proxy deployment procedure.

Rollback is limited to application images; it preserves database migrations, volumes and secret files. New migrations must remain compatible with the previous application release. The exact prior images are pinned under `neurovector-ci-{backend,frontend,dashboard}-rollback:*`; their override is retained at `$CI_STATE_DIR/rollback.*/compose.yaml` for operator recovery. On the first dashboard deployment, rollback removes only the newly created dashboard container and validates the previously existing application services. Backend and frontend containers must already exist. No automated image pruning is performed. If rollback itself fails, inspect `result.json`, its log, and container health before retrying the recorded override with the same three deployment Compose files. `infra/ci/test-deploy.sh` verifies migration failure, health-failure rollback, rollback failure, and successful deployment using fake Docker commands only; it runs as part of the shared Python suite.

After app `up --wait`, CD explicitly runs `docker exec nv-frontend nginx -s reload`, even when the frontend image did not change. It then validates Nginx and runs the default `smoke-school.sh` hook. Reload, validation or smoke failure enters the same image rollback path; restored apps also reload Nginx and rerun both checks. Bind-mounted Nginx configuration is workspace source: image rollback **does not restore an older config file**. An invalid or incompatible source config may therefore cause `rollback_failed`; repair that file through normal review rather than resetting user changes.

The read-only smoke hook requests `/healthz`, `/api-docs/openapi.json`, `/api/v1/reviews`, `/swagger-ui/`, and `/nv-dash/`. Dashboard HTML must reference JavaScript and CSS under `/nv-dash/assets/`; those files must serve nonempty assets with matching content types, and a missing asset must return 404. It requires review and WHEP OpenAPI operations with `application/sdp` request/201 response media types, JSON review-list data, and actual Swagger markup/assets rather than SPA fallback. It never reads ICE configuration or secrets, and never prints HTTP bodies. Startup/Docker DNS failures retry within a 90-second scheduling budget; each request is capped at five seconds. `CI_DEPLOY_SMOKE_CHECK` can override the executable; `CI_SMOKE_BASE_URL` defaults to `http://127.0.0.1:18083`. `test-smoke.sh` verifies valid output plus rejection of SPA/missing-contract responses using fake curl, including unavailable dashboard assets and HTML fallbacks. Both shell mock suites run in the shared Python checks.

The release delivery workflow (`.github/workflows/ci-cd.yml`) also runs the shared dashboard suite and builds the dashboard GHCR image from `./nv-dash`. The release deployment workflow pulls and applies backend, frontend, vision and dashboard images pinned to the same platform commit SHA through `compose.release.yaml`.
