#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.13"
# dependencies = ["pydantic>=2.12,<3"]
# ///
# ─── How to run ───
# 1. Install uv: curl -LsSf https://astral.sh/uv/install.sh | sh
# 2. Run: uv run infra/ci/school_idle.py
# 3. Or run infra/ci/school-idle.sh to reuse the existing vision environment.
# ──────────────────
"""Refuse app replacement unless fresh simulator state confirms an idle drone."""

from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, ValidationError


class SchoolState(BaseModel):
    """Strict subset of the simulator export required for deployment safety."""

    model_config = ConfigDict(strict=True, frozen=True, allow_inf_nan=False)
    timestamp: float
    armed: bool
    mode: Literal["waiting_for_order", "order_completed"]
    order_id: None


def main() -> None:
    """Check the workspace's authoritative state; any uncertainty blocks CD."""
    state_path = Path(__file__).resolve().parents[2] / "runtime/school/state.json"
    try:
        state = SchoolState.model_validate_json(state_path.read_bytes())
    except (OSError, ValidationError) as error:
        print(
            f"Deployment deferred: unavailable or invalid simulator state: {error}",
            file=sys.stderr,
        )
        raise SystemExit(1) from error
    age = time.time() - state.timestamp
    if state.armed or not 0 <= age <= 5:
        print(
            "Deployment deferred: armed drone or simulator state outside 0–5s freshness window.",
            file=sys.stderr,
        )
        raise SystemExit(1)
    print(
        f"Flight idle: {state.mode}, disarmed, no active order; state age {age:.2f}s."
    )


if __name__ == "__main__":
    main()
