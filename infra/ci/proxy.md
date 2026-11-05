# School reverse proxy deployment

`infra/school-nginx.conf` is mounted read-only into `nv-frontend` as `/etc/nginx/conf.d/default.conf`. It is an `http`-context include and requires Nginx **1.27.3 or newer**. The current container reports 1.27.5. Docker's embedded resolver (`127.0.0.11`) refreshes backend/simulator addresses every 10 seconds, so recreating those services does not require restarting Nginx to pick up their addresses. Existing requests can still fail during replacement; this is not zero-downtime deployment.

The public HTTPS endpoint is terminated by Cloudflared; the origin remains bound to `127.0.0.1:18083`. The proxy accepts only `http`/`https` forwarded scheme values and otherwise uses its local scheme. This trusts the tunnel: keep the origin inaccessible to public clients and ensure the tunnel overwrites the forwarded scheme. Forwarded client addresses are informational, not authorization evidence. TLS certificates, DNS and tunnel credentials remain managed outside this config.

API, Swagger and API documentation routes keep their paths. Requests retain their methods, content types and bodies, including JSON review photos (2 MiB request ceiling) and WHEP SDP POST/DELETE. `proxy_redirect off` preserves the backend's public canonical WHEP session `Location`; the backend must produce the correct public URL. HTTP/1.1 and idle upstream connections are enabled. Backend connect timeout is 5 seconds; send/read inactivity timeouts are 60 seconds. Desktop WebSockets retain their separate 24-hour read timeout and conditional Upgrade headers.

Successful hashed Vite assets under `/assets/` and `/monitor/assets/` receive one-year immutable caching. Both asset prefixes use explicit static locations: missing chunks return 404 rather than the SPA HTML fallback. HTML, SPA fallback documents, API replies, live simulation files and `/webrtc-config.json` use `no-store`. Mutable simulation assets are revalidated. Minimal `nosniff` and referrer headers apply consistently, including errors. No restrictive CSP/frame policy is introduced without testing the media and noVNC interfaces.

## Review and apply

1. Keep CI in check mode while flight/media testing is active. Do not expose privileged deployment runners to public pull requests.
2. Review the candidate config and retain a copy of the prior version outside the container. Avoid printing runtime WebRTC config, credentials, SDP or ICE secrets.
3. Validate the actual mounted candidate with the existing container:

   ```sh
   docker exec nv-frontend nginx -t
   ```

   This parses the configuration without signaling the running master. A bind-mounted edit is not active until a reload or container replacement. Enable the existing CI pre-deployment hook with `CI_DEPLOY_PROXY_CHECK="$(pwd)/infra/ci/check-proxy.sh"` alongside the required idle guard when invoking `infra/ci/run.sh deploy`. The hook runs this same validation before replacement.
4. Once the operator confirms the deployment window and active flight/media constraints, apply the reviewed config through the approved frontend deployment or a deliberate graceful Nginx reload. A reload can retire old workers while long-lived WebSockets remain; it is not a guarantee that every stream survives a frontend container replacement.
5. Check `/healthz`, the customer SPA and a deep-link refresh, `/monitor/`, `/swagger-ui/`, and `/api-docs/`. Verify HTML has `no-store`, a real hashed bundle has `immutable`, and a missing asset/error is not immutable. Verify public requests preserve HTTPS at the backend and produce no mixed-content URLs.
6. Perform an authorized review photo upload near the client limit. During an idle media test, create a WHEP session, verify its public Location without logging SDP, DELETE that session, and confirm desktop WebSocket upgrade. These are operational tests, not CI syntax checks.
7. In an idle deployment window, recreate the backend normally and verify API recovery after Docker DNS refresh without reloading the frontend. Do not force this test during a flight or stream session.

For rollback, restore the previous reviewed config, run `nginx -t` again, then apply it using the same approved mechanism. No secret/volume deletion is needed. Raw SRT and WebRTC ICE media use their existing separate network/TURN paths; this HTTP reverse proxy does not proxy UDP or replace TURN TLS.

## Evidence for this change

On 2026-11-05, Nginx 1.27.5 passed configuration validation and was deployed through `infra/ci/run.sh deploy`, including a graceful reload and HTTP smoke checks. `runtime/qa/reviews/proxy-runtime.json` records successful health/OpenAPI routing, no-store HTML/config, immutable hashed JavaScript, 404/no-store for missing customer and monitor assets, and a 101 desktop WebSocket upgrade. Separate real browser evidence verifies public WHEP playback and cleanup. App replacement was performed only after the idle guard passed; no simulator/media container was restarted. The backend replacement smoke passed, but a timed DNS-expiry fault test was not performed.

Nginx documents the `resolve` shared-memory/resolver requirements and its open-source availability since 1.27.3 in the [upstream module reference](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#server). See the [proxy module reference](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) for keepalive headers, timeouts and redirect behavior.
