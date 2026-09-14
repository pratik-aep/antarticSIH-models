"""Backend Iceberg prediction & trajectory generator module.

Integrates physics-based drift modeling (adapted from model/iceberg-drift/src/iceberg_drift)
driven by mock surface ocean current vectors, ERA5 surface winds, and Coriolis deflection.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone, timedelta
from typing import Any

from . import geo

# Physical constants for physics drift equations
AIR_DENSITY = 1.225       # kg/m^3
WATER_DENSITY = 1028.0    # kg/m^3
EARTH_ROTATION = 7.2921e-5 # rad/s


def compute_environmental_drift(lat: float, lon: float, size_category: str = "medium") -> dict[str, float]:
    """Compute physics-based iceberg drift velocity from mock ocean current and surface wind fields.

    Adapted from physics_model.py (in model/iceberg-drift/src/iceberg_drift/models/physics_model.py):
        V_iceberg = V_current + alpha * V_wind + Coriolis_deflection
    """
    # Mock ocean current field (m/s) and ERA5 surface wind (m/s)
    if lat < -50.0:
        # Southern Ocean / Prydz Bay corridor
        u_curr = -0.22 * math.sin(math.radians(lon)) - 0.12
        v_curr = 0.18 * math.cos(math.radians(lon)) + 0.08
        u_wind = 8.5
        v_wind = -3.2
        coriolis_deflect_deg = -15.0  # Deflects left in Southern Hemisphere
    else:
        # North Atlantic / Labrador corridor
        u_curr = 0.18
        v_curr = -0.28
        u_wind = 4.5
        v_wind = -7.5
        coriolis_deflect_deg = 15.0   # Deflects right in Northern Hemisphere

    # Wind drift factor alpha (~1.5% to 2.2% based on iceberg size)
    alpha = 0.015 if size_category == "large" else 0.018 if size_category == "medium" else 0.022

    # Combined drift velocity vector components (m/s)
    v_ice_u = u_curr + alpha * u_wind
    v_ice_v = v_curr + alpha * v_wind

    # Speed in m/s -> knots (1 m/s = 1.94384 kn)
    speed_m_s = math.hypot(v_ice_u, v_ice_v)
    speed_knots = max(0.2, round(speed_m_s * 1.94384, 2))

    # Heading angle in degrees (0° = North, 90° = East)
    raw_heading_rad = math.atan2(v_ice_u, v_ice_v)
    heading_deg = round((math.degrees(raw_heading_rad) + coriolis_deflect_deg) % 360.0, 1)

    current_speed_knots = round(math.hypot(u_curr, v_curr) * 1.94384, 2)
    current_dir_deg = round((math.degrees(math.atan2(u_curr, v_curr))) % 360.0, 1)
    wind_speed_knots = round(math.hypot(u_wind, v_wind) * 1.94384, 2)
    wind_dir_deg = round((math.degrees(math.atan2(u_wind, v_wind))) % 360.0, 1)

    return {
        "speedKnots": speed_knots,
        "headingDeg": heading_deg,
        "currentSpeedKnots": current_speed_knots,
        "currentDirDeg": current_dir_deg,
        "windSpeedKnots": wind_speed_knots,
        "windDirDeg": wind_dir_deg,
    }


# Seeded mock icebergs in polar navigation corridors
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
    """Given an iceberg's initial state and a target time, return predicted {lat, lon, timestamp, headingDeg, speedKnots}."""
    init_pos = iceberg_initial.get("initialPosition", iceberg_initial)
    init_lat = float(init_pos["lat"])
    init_lon = float(init_pos["lon"])
    init_time = _parse_ts(init_pos.get("timestamp", "2026-09-14T00:00:00Z"))
    target_dt = _parse_ts(target_time)

    size_cat = str(iceberg_initial.get("sizeCategory", "medium"))
    env = compute_environmental_drift(init_lat, init_lon, size_category=size_cat)

    heading_deg = float(iceberg_initial.get("headingDeg", env["headingDeg"]))
    speed_knots = float(iceberg_initial.get("speedKnots", env["speedKnots"]))

    elapsed_hours = (target_dt - init_time).total_seconds() / 3600.0
    dist_nm = speed_knots * elapsed_hours
    dist_m = dist_nm * geo.NM_TO_M

    lat2, lon2 = geo.vincenty_direct(init_lat, init_lon, heading_deg, dist_m)
    return {
        "lat": round(lat2, 4),
        "lon": round(lon2, 4),
        "timestamp": target_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "headingDeg": heading_deg,
        "speedKnots": speed_knots,
    }


def generate_trajectory(
    iceberg_initial: dict[str, Any],
    start_time: datetime | str,
    end_time: datetime | str,
    step_hours: float = 1.0,
) -> list[dict[str, Any]]:
    """Return a list of {lat, lon, timestamp, headingDeg, speedKnots} points from start_time to end_time."""
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

    if not trajectory or trajectory[-1]["timestamp"] != end_dt.strftime("%Y-%m-%dT%H:%M:%SZ"):
        trajectory.append(predict_position(iceberg_initial, end_dt))

    return trajectory


def get_all_icebergs_with_trajectories(
    start_time: datetime | str,
    end_time: datetime | str,
    step_hours: float = 1.0,
) -> list[dict[str, Any]]:
    """Return list of Iceberg objects containing their generated trajectories and environmental forcing."""
    result = []
    for berg in DEFAULT_MOCK_ICEBERGS:
        init_lat = berg["initialPosition"]["lat"]
        init_lon = berg["initialPosition"]["lon"]
        env = compute_environmental_drift(init_lat, init_lon, size_category=berg["sizeCategory"])

        berg_copy = dict(berg)
        berg_copy["headingDeg"] = env["headingDeg"]
        berg_copy["speedKnots"] = env["speedKnots"]

        traj = generate_trajectory(berg_copy, start_time, end_time, step_hours=step_hours)
        item = {
            "id": berg["id"],
            "name": berg["name"],
            "sizeCategory": berg["sizeCategory"],
            "initialPosition": berg["initialPosition"],
            "headingDeg": env["headingDeg"],
            "speedKnots": env["speedKnots"],
            "currentSpeedKnots": env["currentSpeedKnots"],
            "currentDirDeg": env["currentDirDeg"],
            "windSpeedKnots": env["windSpeedKnots"],
            "windDirDeg": env["windDirDeg"],
            "trajectory": traj,
        }
        result.append(item)
    return result
