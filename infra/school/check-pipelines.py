# /// script
# requires-python = ">=3.13"
# dependencies = ["httpx2[http2,brotli,zstd]"]
# ///
# Run: NV_RUN_LIVE_QA=1 vision/.venv/bin/python infra/school/check-pipelines.py
"""Exercise live ingestion using an owned QA drone, then remove only its rows/cache."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import time
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Final

import httpx2

ROOT: Final = Path(__file__).resolve().parents[2]
BASE: Final = "http://127.0.0.1:18081"
WEB: Final = "https://neurovector-sim.forge-lang.org"


@dataclass(frozen=True, slots=True)
class Check:
    name: str
    detail: str


def run(command: list[str], payload: str | None = None) -> str:
    result = subprocess.run(
        command, input=payload, text=True, capture_output=True, timeout=20, check=True
    )
    return result.stdout.strip()


def main() -> None:
    if os.environ.get("NV_RUN_LIVE_QA") != "1":
        raise RuntimeError("Set NV_RUN_LIVE_QA=1 to exercise the running deployment")
    checks: list[Check] = []
    owned = "pipeline-qa-" + uuid.uuid4().hex[:12]
    key = f"neurovector:drone:{owned}:status"
    transport = httpx2.HTTPTransport(
        retries=3, socket_options=[(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)]
    )
    with httpx2.Client(
        transport=transport,
        http2=True,
        follow_redirects=True,
        headers={"User-Agent": "Mozilla/5.0"},
        limits=httpx2.Limits(
            max_connections=200, max_keepalive_connections=40, keepalive_expiry=30
        ),
        timeout=httpx2.Timeout(connect=5, read=30, write=10, pool=10),
    ) as client:
        ready = client.get(BASE + "/health/ready")
        ready.raise_for_status()
        assert ready.json()["postgres"] == "ok" and ready.json()["redis"] == "ok"
        checks.append(Check("backend_postgres_redis", "readiness reports ok"))
        vision = client.get("http://127.0.0.1:18082/health")
        vision.raise_for_status()
        assert vision.json()["status"] == "ok" and vision.json()["models"]["object"].endswith(
            "school_obstacles_best.pt"
        )
        checks.append(Check("real_model", "school_obstacles_best.pt loaded; health ok"))
        stream = client.get(BASE + "/api/v1/streams/school-drone-001").json()
        assert (
            stream["active"]
            and stream["path"]["ready"]
            and stream["path"]["source"]["type"] == "srtConn"
        )
        assert stream["path"]["inboundBytes"] > 0 and stream["path"]["inboundFramesInError"] == 0
        checks.append(
            Check(
                "srt_ingest_backend",
                f"H264 active, bytes={stream['path']['inboundBytes']}, frame errors=0",
            )
        )
        files = client.get(BASE + "/api/v1/recordings?drone_id=school-drone-001").json()
        assert len(files) >= 2
        recording = client.get(BASE + files[1]["download_url"])
        recording.raise_for_status()
        clip = ROOT / "runtime/school/qa-recording.mp4"
        clip.write_bytes(recording.content)
        try:
            metadata = json.loads(
                run(
                    [
                        "docker",
                        "exec",
                        "nv-sim",
                        "ffprobe",
                        "-v",
                        "error",
                        "-show_entries",
                        "format=duration:stream=codec_name,width,height",
                        "-of",
                        "json",
                        "/runtime/qa-recording.mp4",
                    ]
                )
            )
            assert (
                metadata["streams"][0]["codec_name"] == "h264"
                and float(metadata["format"]["duration"]) > 0
            )
            checks.append(
                Check(
                    "recording_download_decode",
                    f"bytes={len(recording.content)}, duration={metadata['format']['duration']}s",
                )
            )
        finally:
            clip.unlink(missing_ok=True)
        client.get(BASE + "/api/v1/inventory").raise_for_status()
        cached = client.get(BASE + "/api/v1/inventory")
        cached.raise_for_status()
        assert cached.headers.get("x-cache") == "HIT"
        checks.append(Check("redis_cache", "inventory second read X-Cache: HIT"))
        offsets = run(
            [
                "docker",
                "exec",
                "nv-kafka",
                "/opt/kafka/bin/kafka-get-offsets.sh",
                "--bootstrap-server",
                "localhost:9092",
                "--topic",
                "neurovector.events",
            ]
        )
        offset = next(line.split(":")[-1] for line in offsets.splitlines() if ":0:" in line)
        try:
            for suffix, payload in [
                ("detections", {"label": "pipeline_qa", "confidence": 0.99, "priority_level": 2}),
                ("telemetry", {"status": "idle", "altitude_m": 0}),
            ]:
                command = (
                    'mosquitto_pub -h localhost -u "$MQTT_USERNAME" -P "$MQTT_PASSWORD" '
                    f"-t neurovector/drones/{owned}/{suffix} -s"
                )
                run(
                    ["docker", "exec", "-i", "nv-mosquitto", "sh", "-c", command],
                    json.dumps(payload),
                )
            for _attempt in range(12):
                rows = client.get(BASE + "/api/v1/detections?limit=200").json()
                found = [row for row in rows if row["drone_id"] == owned]
                if found:
                    break
                time.sleep(0.5)
            assert found and found[0]["label"] == "pipeline_qa"
            checks.append(
                Check("mqtt_detection_postgres", "authenticated MQTT ingestion found by HTTP API")
            )
            for _attempt in range(12):
                status = client.get(BASE + "/api/v1/flights/status/" + owned)
                if status.status_code == 200:
                    break
                time.sleep(0.5)
            status.raise_for_status()
            assert status.json()["online"] and status.json()["status"] == "idle"
            checks.append(
                Check("mqtt_telemetry_backend", "owned QA drone online with ingested status")
            )
            value = run(
                [
                    "docker",
                    "exec",
                    "nv-redis",
                    "sh",
                    "-c",
                    f'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning GET {key}',
                ]
            )
            assert json.loads(value)["latest"]["drone_id"] == owned
            checks.append(
                Check("telemetry_redis", "latest status cached under the owned drone key")
            )
            consumed = subprocess.run(
                [
                    "docker",
                    "exec",
                    "nv-kafka",
                    "/opt/kafka/bin/kafka-console-consumer.sh",
                    "--bootstrap-server",
                    "localhost:9092",
                    "--topic",
                    "neurovector.events",
                    "--partition",
                    "0",
                    "--offset",
                    offset,
                    "--timeout-ms",
                    "4000",
                    "--max-messages",
                    "30",
                ],
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            )
            events = [
                json.loads(line) for line in consumed.stdout.splitlines() if line.startswith("{")
            ]
            assert any(event.get("drone_id") == owned for event in events)
            checks.append(
                Check("mqtt_backend_kafka", "same owned detection observed in Kafka partition 0")
            )
        finally:
            sql = (
                f"DELETE FROM neurovector.telemetry WHERE drone_id='{owned}'; "
                f"DELETE FROM neurovector.detections WHERE drone_id='{owned}'; "
                f"DELETE FROM neurovector.flight_sessions WHERE drone_id='{owned}';"
            )
            run(
                [
                    "docker",
                    "exec",
                    "-i",
                    "nv-postgres",
                    "sh",
                    "-c",
                    'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
                ],
                sql,
            )
            run(
                [
                    "docker",
                    "exec",
                    "nv-redis",
                    "sh",
                    "-c",
                    f'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning DEL {key}',
                ]
            )
        credentials = dict(
            line.split("=", 1)
            for line in (ROOT / ".env").read_text().splitlines()
            if "=" in line and not line.startswith("#")
        )
        login = client.post(
            WEB + "/api/v1/admin/auth/login",
            json={
                "username": credentials.get("ADMIN_USERNAME", "admin"),
                "password": credentials["ADMIN_PASSWORD"],
            },
        )
        login.raise_for_status()
        client.get(WEB + "/api/v1/admin/auth/me").raise_for_status()
        for path in [
            "/api/v1/admin/orders",
            "/api/v1/admin/queue/stats",
            "/api/v1/admin/cache/stats",
        ]:
            client.get(WEB + path).raise_for_status()
        logout = client.post(WEB + "/api/v1/admin/auth/logout")
        logout.raise_for_status()
        assert client.get(WEB + "/api/v1/admin/auth/me").status_code == 401
        checks.append(
            Check(
                "public_admin_session",
                "HTTPS login/me/admin reads/logout; revoked session rejected",
            )
        )
        state = json.loads((ROOT / "runtime/school/state.json").read_bytes())
        assert time.time() - state["timestamp"] < 10 and state["position_enu"] is not None
        checks.append(
            Check(
                "sim_live_telemetry",
                f"fresh Gazebo position; controller={state['mode']}, armed={state['armed']}",
            )
        )
    report = {
        "checked_at": time.time(),
        "checks": [asdict(check) for check in checks],
        "owned_qa_rows_removed": True,
    }
    destination = ROOT / "runtime/school-pipeline-report.json"
    destination.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
