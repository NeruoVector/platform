#!/usr/bin/env bash
set -euo pipefail
# Validate the bind-mounted candidate without reloading or restarting Nginx.
exec docker exec nv-frontend nginx -t
