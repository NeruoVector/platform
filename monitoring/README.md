# School flight monitor

Preserved from the prior frontend before adopting NeruoVector/frontend af54ea8.
Includes the live campus map, WebRTC camera, backend status and administrator UI.
The customer application lives in ../frontend. Production serves this monitor at /monitor/.

Build from the repository root:

```bash
npm --prefix monitoring ci
VITE_DEFAULT_DRONE_ID=school-drone-001 npm --prefix monitoring run build -- --base=/monitor/
mkdir -p runtime/monitoring-dist
cp -a monitoring/dist/. runtime/monitoring-dist/
```

compose.school.yaml mounts runtime/monitoring-dist into the frontend server.
API and camera paths remain relative to the same origin, with shared backend sessions.
