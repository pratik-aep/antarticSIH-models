"""Backend Iceberg prediction & trajectory generator module (Stage 5).

Provides modular, swap-in ready interface for predicting iceberg movement over time.
Currently uses deterministic linear drift model via Vincenty geodesic propagation.
Future ML/physical models can be swapped into `predict_position` without changing API contracts.
"""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any

from . import geo


# Seeded mock icebergs placed in key polar / navigation corridors
# (e.g. Prydz Bay / Southern Ocean near Antarctica legs, and North Atlantic)
DEFAULT_MOCK_ICEBERGS = [
    {
        "id": "berg-alpha",
        "name": "Berg Alpha (A68-a)",
        "sizeCategory": "large",
        "initialPosition": {
            "lat": -65.20,
            "lon": 72.50,
            "timestamp": "2026-09-14T00:00:00Z",
        },
        "headingDeg": 290.0,
        "speedKnots": 0.65,
    },
    {
        "id": "berg-beta",
        "name": "Berg Beta (B15-k)",
        "sizeCategory": "medium",
        "initialPosition": {
            "lat": -58.40,
            "lon": 64.10,
            "timestamp": "2026-09-14T00:00:00Z",
        },
        "headingDeg": 045.0,
        "speedKnots": 0.50,
    },
    {
        "id": "berg-gamma",
        "name": "Berg Gamma (A74)",
        "sizeCategory": "large",
        "initialPosition": {
            "lat": 62.10,
            "lon": -48.20,
            "timestamp": "2026-09-14T00:00:00Z",
        },
        "headingDeg": 160.0,
        "speedKnots": 0.75,
    },
]


def _parse_ts(ts_val: str | datetime) -> datetime:
    if isinstance(ts_val, datetime):
        return ts_val if ts_val.tzinfo is not None else ts_val.replace(tzinfo=timezone.utc)
    raw = str(ts_val).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(raw)
        return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return datetime.now(timezone.utc)


def predict_position(iceberg_initial: dict[str, Any], target_time: datetime | str) -> dict[str, Any]:
    """Given an iceberg's initial state and a target time, return {lat, lon, timestamp}."""
    init_pos = iceberg_initial.get("initialPosition", iceberg_initial)
    init_lat = float(init_pos["lat"])
    init_lon = float(init_pos["lon"])
    init_time = _parse_ts(init_pos.get("timestamp", "2026-09-14T00:00:00Z"))
    target_dt = _parse_ts(target_time)

    heading_deg = float(iceberg_initial.get("headingDeg", 270.0))
    speed_knots = float(iceberg_initial.get("speedKnots", 0.5))

    elapsed_hours = (target_dt - init_time).total_seconds() / 3600.0
    dist_nm = speed_knots * elapsed_hours
    dist_m = dist_nm * geo.NM_TO_M

    lat2, lon2 = geo.vincenty_direct(init_lat, init_lon, heading_deg, dist_m)
    return {
        "lat": round(lat2, 4),
        "lon": round(lon2, 4),
        "timestamp": target_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def generate_trajectory(
    iceberg_initial: dict[str, Any],
    start_time: datetime | str,
    end_time: datetime | str,
    step_hours: float = 1.0,
) -> list[dict[str, Any]]:
    """Return a list of {lat, lon, timestamp} points from start_time to end_time."""
    start_dt = _parse_ts(start_time)
    end_dt = _parse_ts(end_time)
    if end_dt < start_dt:
        end_dt = start_dt + timedelta(hours=24)

    step_h = max(0.25, float(step_hours))
    trajectory = []
    curr_dt = start_dt

    while curr_dt <= end_dt:
        pos = predict_position(iceberg_initial, curr_dt)
        trajectory.append(pos)
        curr_dt += timedelta(hours=step_h)

    # Always include end_dt explicitly if not aligned
    if not trajectory or trajectory[-1]["timestamp"] != end_dt.strftime("%Y-%m-%dT%H:%M:%SZ"):
        trajectory.append(predict_position(iceberg_initial, end_dt))

    return trajectory


def get_all_icebergs_with_trajectories(
    start_time: datetime | str,
    end_time: datetime | str,
    step_hours: float = 1.0,
) -> list[dict[str, Any]]:
    """Return list of Iceberg objects containing their generated trajectories."""
    result = []
    for berg in DEFAULT_MOCK_ICEBERGS:
        traj = generate_trajectory(berg, start_time, end_time, step_hours=step_hours)
        item = {
            "id": berg["id"],
            "name": berg["name"],
            "sizeCategory": berg["sizeCategory"],
            "initialPosition": berg["initialPosition"],
            "headingDeg": berg["headingDeg"],
            "speedKnots": berg["speedKnots"],
            "trajectory": traj,
        }
        result.append(item)
    return result
