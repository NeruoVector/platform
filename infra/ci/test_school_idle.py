"""Deployment safety regressions without modifying live simulator state."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import school_idle
from pydantic import ValidationError


@pytest.mark.parametrize("mode", ["waiting_for_order", "order_completed"])
def test_fresh_disarmed_idle_state_passes(
    monkeypatch: pytest.MonkeyPatch, mode: str
) -> None:
    raw = json.dumps(
        {"timestamp": 100.0, "armed": False, "mode": mode, "order_id": None}
    ).encode()
    monkeypatch.setattr(Path, "read_bytes", lambda _: raw)
    monkeypatch.setattr(school_idle.time, "time", lambda: 101.0)
    school_idle.main()


@pytest.mark.parametrize(
    "raw",
    [
        b"{}",
        b"null",
        b"not-json",
        b'{"timestamp":"100","armed":false,"mode":"waiting_for_order","order_id":null}',
        b'{"timestamp":100,"armed":0,"mode":"waiting_for_order","order_id":null}',
        b'{"timestamp":100,"armed":false,"mode":"flying","order_id":null}',
        b'{"timestamp":100,"armed":false,"mode":"hold","order_id":null}',
        b'{"timestamp":100,"armed":false,"mode":"waiting_for_order","order_id":"active"}',
        b'{"timestamp":NaN,"armed":false,"mode":"waiting_for_order","order_id":null}',
    ],
)
def test_invalid_state_fields_fail_closed(raw: bytes) -> None:
    with pytest.raises(ValidationError):
        school_idle.SchoolState.model_validate_json(raw)


@pytest.mark.parametrize(
    ("timestamp", "armed"), [(94.9, False), (101.0, False), (100.0, True)]
)
def test_stale_future_or_armed_state_blocks(
    monkeypatch: pytest.MonkeyPatch,
    timestamp: float,
    armed: bool,
) -> None:
    raw = json.dumps(
        {
            "timestamp": timestamp,
            "armed": armed,
            "mode": "waiting_for_order",
            "order_id": None,
        }
    ).encode()
    monkeypatch.setattr(Path, "read_bytes", lambda _: raw)
    monkeypatch.setattr(school_idle.time, "time", lambda: 100.0)
    with pytest.raises(SystemExit, match="1"):
        school_idle.main()


def test_missing_file_blocks(monkeypatch: pytest.MonkeyPatch) -> None:
    def missing(_: Path) -> bytes:
        raise FileNotFoundError

    monkeypatch.setattr(Path, "read_bytes", missing)
    with pytest.raises(SystemExit, match="1"):
        school_idle.main()
