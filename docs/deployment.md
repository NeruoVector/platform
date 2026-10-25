# CI/CD and backend tunnel

## CI and image delivery

`.github/workflows/ci-cd.yml` checks the platform's pinned submodule commits on
main pushes and pull requests. It runs frontend lint/build, Rust format/Clippy and
tests with PostgreSQL/Redis, vision Ruff/tests, strict Release drone CTest, generated
school geometry checks, and ROS Jazzy camera relay tests.

After all checks pass on main, the backend/frontend/vision Docker images are
published to `ghcr.io/neruovector/platform-{service}:{full-platform-commit-sha}`.
Pull requests cannot publish or deploy. Actions are pinned to verified release
commit hashes. Image tags use the platform SHA so the three images and source
submodule pointers belong to one release.

## Deployment

`.github/workflows/deploy.yml` deploys a successful main release automatically;
workflow_dispatch can redeploy a previously successful full SHA. The workflow
rechecks the CI result, checks out that exact commit, pulls those images, runs
the committed migrations and waits for application health checks. It serializes
deployments and never deletes database volumes.

The server needs Docker Compose, Git, gh CLI and a dedicated self-hosted runner
with label `neurovector-production`. The GitHub `production` environment variable
`RELEASE_ENV_FILE` must point to an absolute env file on that server; keep it
outside the runner checkout. The initial installation uses this workspace's
ignored `.env` and a user systemd service `neurovector-runner.service`.
Runner credentials stay outside the repository. Protect deployment branches and
apply required reviewers to `production` if your deployment policy requires them.

Compose uses the existing `neurovector` project/volumes. The release override only
selects immutable images and does not embed credentials. Migrations must remain
backward compatible; restarting an older image does not undo schema changes.
The default vision image follows the Dockerfile's model-free build; production
YOLO weights and the vision optional dependencies require the model-enabled image.

## Cloudflare backend access

The initial backend is running from the existing compose configuration on 8081.
A user systemd `neurovector-tunnel.service` forwards a Cloudflare Quick Tunnel to
`http://127.0.0.1:8081`. Inspect its current public hostname using:

```sh
systemctl --user status neurovector-tunnel.service
journalctl --user -u neurovector-tunnel.service --no-pager | rg 'https://.*trycloudflare.com'
```

Use `/health/ready`, `/swagger-ui/` and `/api/v1/...` on that HTTPS hostname.
The administrator password was randomized in the ignored, mode-600 `.env` file;
it is not committed. Keep the host, Docker Desktop and user services running.
Quick Tunnel hostnames change when the tunnel is recreated and have no uptime
guarantee. A fixed production hostname needs an owned DNS name and named tunnel:
[Cloudflare Quick Tunnel contract](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

The HTTP tunnel carries API/WHEP signalling, not WebRTC UDP media. Remote video
still requires reachable ICE addresses or a configured TURN relay as described in
[`sim/docs/camera-stream.md`](../sim/docs/camera-stream.md).
