# /// script
# requires-python = ">=3.13"
# dependencies = ["httpx2[http2,brotli,zstd]"]
# ///
# Run: NV_RUN_LIVE_QA=1 vision/.venv/bin/python infra/school/check-commerce.py
"""Verify the existing dummy checkout through Kafka using only owned QA records."""

import json
import os
import socket
import subprocess
import time
import uuid
from pathlib import Path

import httpx2


def main() -> None:
    if os.environ.get("NV_RUN_LIVE_QA") != "1":
        raise RuntimeError("Live commerce QA requires NV_RUN_LIVE_QA=1")
    root = Path(__file__).resolve().parents[2]
    owned = "pipelineqa" + uuid.uuid4().hex
    item_id = None
    job_id = None
    base = "https://neurovector-sim.forge-lang.org"
    credentials = dict(
        line.split("=", 1)
        for line in (root / ".env").read_text().splitlines()
        if "=" in line and not line.startswith("#")
    )
    transport = httpx2.HTTPTransport(
        retries=3, socket_options=[(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)]
    )
    with httpx2.Client(
        http2=True,
        transport=transport,
        follow_redirects=True,
        headers={"User-Agent": "Mozilla/5.0"},
        limits=httpx2.Limits(
            max_connections=200, max_keepalive_connections=40, keepalive_expiry=30
        ),
        timeout=httpx2.Timeout(connect=5, read=30, write=10, pool=10),
    ) as client:
        response = client.post(
            base + "/api/v1/admin/auth/login",
            json={
                "username": credentials.get("ADMIN_USERNAME", "admin"),
                "password": credentials["ADMIN_PASSWORD"],
            },
        )
        response.raise_for_status()
        try:
            response = client.post(
                base + "/api/v1/inventory",
                json={
                    "sku": owned,
                    "name": "Pipeline QA temporary item",
                    "unit_price": 1,
                    "stock_quantity": 2,
                },
            )
            response.raise_for_status()
            item_id = str(uuid.UUID(response.json()["id"]))
            response = client.post(
                base + "/api/v1/orders/queue",
                json={
                    "customer_name": "Pipeline QA",
                    "customer_phone": owned,
                    "delivery_address": "Synthetic QA; no physical delivery",
                    "notes": "Temporary integration QA",
                    "items": [{"item_id": item_id, "quantity": 1}],
                },
            )
            response.raise_for_status()
            queued = response.json()
            assert queued["kafka_published"]
            job_id = str(uuid.UUID(queued["job"]["id"]))
            for _attempt in range(30):
                job = client.get(base + "/api/v1/orders/jobs/" + job_id)
                job.raise_for_status()
                if job.json()["status"] == "completed":
                    break
                if job.json()["status"] == "failed":
                    raise RuntimeError(job.json()["last_error"])
                time.sleep(0.5)
            assert job.json()["status"] == "completed"
            order_id = str(uuid.UUID(job.json()["order_id"]))
            order = client.get(base + "/api/v1/orders/" + order_id)
            order.raise_for_status()
            assert order.json()["status"] == "pending_payment"
            reserved = client.get(base + "/api/v1/inventory/" + item_id)
            reserved.raise_for_status()
            assert reserved.json()["stock_quantity"] == 1
            response = client.post(
                base + "/api/v1/orders/" + order_id + "/payments",
                json={"method": "card", "simulate": "success"},
            )
            response.raise_for_status()
            payment = response.json()
            assert payment["provider"] == "dummy" and payment["status"] == "captured"
            paid = client.get(base + "/api/v1/orders/" + order_id)
            paid.raise_for_status()
            assert paid.json()["status"] == "paid"
            refund = client.post(base + "/api/v1/payments/" + payment["id"] + "/refund")
            refund.raise_for_status()
            assert refund.json()["status"] == "refunded"
            restored = client.get(base + "/api/v1/inventory/" + item_id)
            restored.raise_for_status()
            assert restored.json()["stock_quantity"] == 2
            report = {
                "checked_at": time.time(),
                "queue_kafka_worker": "completed",
                "stock_reservation": "2 -> 1",
                "payment": "dummy captured; no external provider",
                "refund": "refunded; stock 1 -> 2",
                "owned_records_removed": True,
            }
        finally:
            if item_id is not None:
                response = client.patch(
                    base + "/api/v1/inventory/" + item_id, json={"active": False}
                )
                response.raise_for_status()
            job_clause = (
                (
                    f"DELETE FROM neurovector.order_jobs WHERE id='{job_id}'; "
                    f"DELETE FROM neurovector.order_events WHERE job_id='{job_id}';"
                )
                if job_id
                else ""
            )
            sql = (
                f"BEGIN; {job_clause} "
                "DELETE FROM neurovector.order_events WHERE order_id IN "
                f"(SELECT id FROM neurovector.orders WHERE customer_phone='{owned}'); "
                f"DELETE FROM neurovector.orders WHERE customer_phone='{owned}'; "
                f"DELETE FROM neurovector.inventory_items WHERE sku='{owned}'; COMMIT;"
            )
            subprocess.run(
                [
                    "docker",
                    "exec",
                    "-i",
                    "nv-postgres",
                    "sh",
                    "-c",
                    'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
                ],
                input=sql,
                text=True,
                capture_output=True,
                check=True,
                timeout=20,
            )
            client.post(base + "/api/v1/admin/auth/logout").raise_for_status()
    (root / "runtime/commerce-pipeline-report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
