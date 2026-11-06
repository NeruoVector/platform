# /// script
# requires-python = ">=3.13"
# dependencies = ["psutil", "pydantic", "httpx2[http2,brotli,zstd]"]
# ///
"""Sample running school services and apply a bounded, read-only API workload."""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Final, Literal

import httpx2
import psutil
from pydantic import BaseModel, ConfigDict

ROOT: Final = Path(__file__).resolve().parents[2]
OUT: Final = ROOT / "runtime/qa/capacity-20261106"
PHASE_SECONDS: Final = 30.0
REQUESTS: Final = 300
PATHS: Final = ("/api/v1/inventory?limit=50", "/api/v1/reviews?limit=20", "/api/v1/flights/status", "/simulation/live/state.json")
NAMES: Final = ("nv-frontend", "nv-backend", "nv-dashboard", "nv-sim", "nv-mediamtx", "nv-postgres", "nv-redis", "nv-kafka", "nv-mosquitto", "neurovector-school-turn-1")
UNITS: Final = {"B": 1, "KiB": 1024, "MiB": 1024**2, "GiB": 1024**3, "TiB": 1024**4}


class Frozen(BaseModel):
    model_config = ConfigDict(frozen=True, extra="ignore")


class DockerStat(Frozen):
    Name: str
    CPUPerc: str
    MemUsage: str
    PIDs: str


class Service(Frozen):
    name: str
    cpu_pct_one_core: float
    memory_bytes: int
    pids: int


class Inference(Frozen):
    timestamp: float
    ok: bool
    elapsed_ms: float | None = None


class Flight(Frozen):
    timestamp: float
    mode: str
    armed: bool
    camera_timestamp: float


class Sample(Frozen):
    timestamp: float
    phase: Literal["baseline", "api_load"]
    host_cpu_pct: float
    host_used_memory_bytes: int
    host_available_memory_bytes: int
    vision_cpu_pct_one_core: float
    vision_rss_bytes: int
    services: tuple[Service, ...]
    inference: Inference
    flight: Flight


class Response(Frozen):
    path: str
    status: int
    elapsed_ms: float
    size_bytes: int
    error: str | None = None


class CapacityError(RuntimeError):
    """A measured value cannot be interpreted safely."""


def memory_bytes(value: str) -> int:
    found = re.fullmatch(r"([\d.]+)([A-Za-z]+)", value.split("/")[0].strip())
    if found is None:
        raise CapacityError("Unrecognized Docker memory quantity")
    return round(float(found[1]) * UNITS[found[2]])


def request(client: httpx2.Client, path: str) -> Response:
    started = time.perf_counter()
    try:
        result = client.get("http://127.0.0.1:18083" + path)
        return Response(path=path, status=result.status_code, elapsed_ms=(time.perf_counter()-started)*1000, size_bytes=len(result.content))
    except httpx2.HTTPError as error:
        return Response(path=path, status=0, elapsed_ms=(time.perf_counter()-started)*1000, size_bytes=0, error=type(error).__name__)


def load() -> list[Response]:
    with httpx2.Client(timeout=5.0, trust_env=False) as client, ThreadPoolExecutor(max_workers=4) as pool:
        started = time.perf_counter()
        futures = []
        for index in range(REQUESTS):
            time.sleep(max(0, started + index / 10 - time.perf_counter()))
            futures.append(pool.submit(request, client, PATHS[index % len(PATHS)]))
        return [future.result() for future in futures]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    vision = next(process for process in psutil.process_iter(["cmdline"]) if "neurovector_vision.api:app" in (process.info["cmdline"] or ()))
    vision.cpu_percent()
    psutil.cpu_percent()
    samples: list[Sample] = []
    responses: list[Response] = []
    with ThreadPoolExecutor(max_workers=1) as pool:
        for phase in (("api_load",) if "--load-only" in sys.argv else ("baseline", "api_load")):
            workload = pool.submit(load) if phase == "api_load" else None
            started = time.perf_counter()
            while time.perf_counter() - started < PHASE_SECONDS:
                raw = subprocess.check_output(["docker", "stats", "--no-stream", "--format", "{{json .}}", *NAMES], text=True)
                records = (DockerStat.model_validate_json(line) for line in raw.splitlines())
                services = tuple(Service(name=r.Name, cpu_pct_one_core=float(r.CPUPerc.removesuffix("%")), memory_bytes=memory_bytes(r.MemUsage), pids=int(r.PIDs)) for r in records)
                memory = psutil.virtual_memory()
                samples.append(Sample(timestamp=time.time(), phase=phase, host_cpu_pct=psutil.cpu_percent(), host_used_memory_bytes=memory.used, host_available_memory_bytes=memory.available, vision_cpu_pct_one_core=vision.cpu_percent(), vision_rss_bytes=vision.memory_info().rss, services=services, inference=Inference.model_validate_json((ROOT/"runtime/school/inference.json").read_text()), flight=Flight.model_validate_json((ROOT/"runtime/school/state.json").read_text())))
            if workload is not None:
                responses = workload.result()
            print(phase, "finished", flush=True)
    report = {"started": samples[0].timestamp, "finished": samples[-1].timestamp, "logical_cpus": psutil.cpu_count(), "physical_cores": psutil.cpu_count(logical=False), "host_ram_bytes": psutil.virtual_memory().total, "target_rps":10, "max_http_workers":4, "samples":[s.model_dump() for s in samples], "responses":[r.model_dump() for r in responses]}
    filename = "measurements-load-verified.json" if "--load-only" in sys.argv else "measurements.json"
    (OUT/filename).write_text(json.dumps(report, indent=2))
    print("Saved", len(samples), "resource samples and", len(responses), "HTTP outcomes", flush=True)


if __name__ == "__main__":
    main()
