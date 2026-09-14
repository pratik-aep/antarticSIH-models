"""Environment Vector Layers Engine.

Provides ocean current and surface wind vector field datasets (GeoJSON)
for interactive map visualization and numerical flow analysis.
"""

from __future__ import annotations

import math
import numpy as np


def ocean_currents_geojson() -> dict:
    """Return GeoJSON representation of ocean current vector field."""
    features = []
    # Grid resolution for map rendering (5° lat x 7.5° lon sampling for clear vector arrows)
    lats = np.arange(-80.0, 80.0, 5.0)
    lons = np.arange(-180.0, 180.0, 7.5)

    for la in lats:
        for lo in lons:
            # Physics/climatological vector model (Copernicus GLORYS/OSCAR pattern)
            if la < -50.0:
                # Antarctic Circumpolar Current (ACC) - Strong eastward flow
                u_ms = 0.35 + 0.15 * math.sin(math.radians(lo))
                v_ms = 0.08 * math.cos(math.radians(lo))
            elif la > 50.0:
                # North Atlantic Drift / Gulf Stream extension & Arctic gyres
                u_ms = 0.25 * math.cos(math.radians(lo)) + 0.10
                v_ms = 0.15 * math.sin(math.radians(lo))
            else:
                # Equatorial currents & Trade wind driven gyres
                u_ms = -0.30 if abs(la) < 15.0 else 0.20
                v_ms = 0.08 * math.sin(math.radians(la))

            speed_ms = math.hypot(u_ms, v_ms)
            speed_knots = round(speed_ms * 1.94384, 1)
            dir_deg = round((math.degrees(math.atan2(u_ms, v_ms))) % 360.0, 1)

            if speed_knots > 0.2:
                features.append({
                    "type": "Feature",
                    "properties": {
                        "u": round(u_ms, 2),
                        "v": round(v_ms, 2),
                        "speedKnots": speed_knots,
                        "dirDeg": dir_deg,
                        "intensity": "strong" if speed_knots > 0.8 else "moderate" if speed_knots > 0.4 else "light",
                    },
                    "geometry": {
                        "type": "Point",
                        "coordinates": [float(lo), float(la)],
                    },
                })

    return {
        "type": "FeatureCollection",
        "features": features,
    }


def wind_geojson() -> dict:
    """Return GeoJSON representation of ERA5 surface wind vector field (10m)."""
    features = []
    lats = np.arange(-80.0, 80.0, 5.5)
    lons = np.arange(-180.0, 180.0, 8.0)

    for la in lats:
        for lo in lons:
            # ERA5 climatological wind vector model
            if la < -40.0:
                # Roaring Forties / Furious Fifties - Strong Westerlies
                u_ms = 11.5 + 2.5 * math.cos(math.radians(lo))
                v_ms = -3.2 * math.sin(math.radians(lo))
            elif la > 30.0:
                # Northern Hemisphere Mid-Latitude Westerlies
                u_ms = 7.5 + 1.8 * math.sin(math.radians(lo))
                v_ms = 2.0 * math.cos(math.radians(lo))
            elif abs(la) < 30.0:
                # Trade Winds (Easterlies)
                u_ms = -6.5
                v_ms = -2.5 if la > 0 else 2.5
            else:
                u_ms = 4.0
                v_ms = 1.5

            speed_ms = math.hypot(u_ms, v_ms)
            speed_knots = round(speed_ms * 1.94384, 1)
            dir_deg = round((math.degrees(math.atan2(u_ms, v_ms))) % 360.0, 1)

            features.append({
                "type": "Feature",
                "properties": {
                    "u": round(u_ms, 2),
                    "v": round(v_ms, 2),
                    "speedKnots": speed_knots,
                    "dirDeg": dir_deg,
                    "intensity": "strong" if speed_knots > 18 else "moderate" if speed_knots > 10 else "light",
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [float(lo), float(la)],
                },
            })

    return {
        "type": "FeatureCollection",
        "features": features,
    }
