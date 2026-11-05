# /// script
# requires-python = ">=3.13"
# dependencies = []
# ///
# Run: NV_RUN_LIVE_QA=1 python3 infra/school/check-vision-recovery.py
"""Stop only the owned inference service, observe a SITL hold, and restore it."""

import json
import math
import os
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class StateSnapshot:
    mode: str
    position_enu: tuple[float, float, float]


def snapshot(path: Path) -> StateSnapshot:
    data = json.loads(path.read_text())
    x, y, z = data["position_enu"]
    return StateSnapshot(str(data["mode"]), (float(x), float(y), float(z)))


def main() -> None:
    if os.environ.get("NV_RUN_LIVE_QA") != "1":
        raise RuntimeError("Live recovery QA requires NV_RUN_LIVE_QA=1")
    root = Path(__file__).resolve().parents[2]
    state_path = root / "runtime/school/state.json"
    before = snapshot(state_path)
    if before.mode not in ("flying", "hold_obstacle"):
        raise RuntimeError("Recovery QA requires an active API order and an airborne simulator")
    try:
        subprocess.run(
            ["systemctl", "--user", "stop", "neurovector-vision"], check=True, timeout=15
        )
        for _attempt in range(20):
            time.sleep(1)
            held = snapshot(state_path)
            if held.mode in ("hold_vision_stale", "hold_order_stale", "hold_no_order"):
                break
        assert held.mode in ("hold_vision_stale", "hold_order_stale", "hold_no_order")
        time.sleep(4)
        first = snapshot(state_path)
        time.sleep(3)
        second = snapshot(state_path)
        drift = math.dist(first.position_enu, second.position_enu)
        assert drift < 0.5
    finally:
        subprocess.run(
            ["systemctl", "--user", "start", "neurovector-vision", "neurovector-school-relay"],
            check=True,
            timeout=20,
        )
    for _attempt in range(40):
        time.sleep(1)
        restored = snapshot(state_path)
        inference = json.loads((root / "runtime/school/inference.json").read_text())
        if inference.get("ok") and restored.mode in ("flying", "hold_obstacle"):
            break
    assert inference.get("ok") and restored.mode in ("flying", "hold_obstacle")
    report = {
        "checked_at": time.time(),
        "before": before.mode,
        "inference_outage": held.mode,
        "hold_drift_m": drift,
        "recovery": restored.mode,
        "inference_restored": True,
    }
    (root / "runtime/vision-recovery-report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
