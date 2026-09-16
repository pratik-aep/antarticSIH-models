"""FastAPI backend for the Ship Route Planner.

POST /api/route        compute a sea route
GET  /api/ports?q=     ports autocomplete
GET  /api/geocode      reverse lookup for dropped pins / typed coords
GET  /api/ecas         ECA polygons as GeoJSON (for the basemap overlay)
GET  /api/chokepoints  chokepoint crossing lines as GeoJSON
GET  /api/health
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

import logging
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .datastore import Datastore
from .mask import LandMask
from .route_engine import RouteEngine, RouteError, build_waterway_midline


class Waypoint(BaseModel):
    id: str = ""
    label: str
    countryCode: Optional[str] = ""
    lat: float
    lon: float
    isPort: bool = True

    def to_dict(self):
        return {
            "id": self.id,
            "label": self.label,
            "countryCode": self.countryCode or "",
            "lat": self.lat,
            "lon": self.lon,
            "isPort": self.isPort,
        }


class RouteRequest(BaseModel):
    waypoints: list[Waypoint] = Field(min_length=2)
    speedKnots: float = Field(gt=0, description="1-24 kn in the UI; not hard-clamped server-side")
    departureTimeUTC: str = Field(default="", description="ISO 8601")
    optimizeFor: str = "distance"  # 'distance' | 'time' (@see phase 2)
    vesselType: str = Field(default="cargo", description="cargo, tanker, passenger, service, fishing, icebreaker, research, other")
    draftMeters: float = Field(default=10.0, description="vessel operational draft in meters")
    iceClass: str = Field(default="none", description="none, pc1_pc7, icebreaker")


def _parse_departure(raw: str) -> datetime:
    raw = (raw or "").strip()
    if not raw:
        return datetime.now(timezone.utc).replace(tzinfo=None, second=0, microsecond=0)
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(422, f"invalid departureTimeUTC: {exc}") from exc
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


import uuid
from .weather_engine import get_route_weather


@asynccontextmanager
async def lifespan(app: FastAPI):
    store = Datastore()
    mask = LandMask()
    for cp in store.chokepoints:
        if cp["kind"] == "strait" and cp["line"]:
            mask.carve_water([(lat, lon) for lon, lat in cp["line"]])
    for w in store.waterways:
        mask.carve_water(build_waterway_midline(w))
    engine = RouteEngine(mask, store.ecas, store.chokepoints, waterways=store.waterways)
    app.state.datastore = store
    app.state.engine = engine
    app.state.routes = {}
    app.state.booted = True
    print("[api] ready", flush=True)
    yield


logger = logging.getLogger(__name__)

app = FastAPI(title="Ship Route Planner", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"ok": True, "booted": getattr(app.state, "booted", False)}


@app.post("/api/route")
async def compute_route(req: RouteRequest):
    try:
        engine: RouteEngine = app.state.engine
    except AttributeError:
        raise HTTPException(503, "route engine not ready")
    dep = _parse_departure(req.departureTimeUTC)
    try:
        res = engine.compute_route(
            [w for w in req.waypoints],
            speed_knots=req.speedKnots,
            departure_time_utc=dep,
            optimize_for=req.optimizeFor or "distance",
            vessel_type=req.vesselType,
            draft_meters=req.draftMeters,
            ice_class=req.iceClass,
        )
        route_id = str(uuid.uuid4())
        res["routeId"] = route_id
        res["departureTimeUTC"] = dep.strftime("%Y-%m-%dT%H:%M:%SZ")
        if hasattr(app.state, "routes"):
            app.state.routes[route_id] = res
            # Keep cache bounded to 50 routes
            if len(app.state.routes) > 50:
                oldest_key = next(iter(app.state.routes))
                app.state.routes.pop(oldest_key, None)
        return res
    except RouteError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.get("/api/route-weather")
async def route_weather(
    routeId: str = Query(default=""),
    departureTime: str = Query(default=""),
    speedKnots: float = Query(default=15.0),
):
    dep = _parse_departure(departureTime)
    routes_cache = getattr(app.state, "routes", {})
    route_obj = routes_cache.get(routeId)
    
    if not route_obj:
        if not routeId and len(routes_cache) > 0:
            # Fall back to most recent computed route
            route_obj = list(routes_cache.values())[-1]

    if not route_obj:
        return {"samples": []}

    return get_route_weather(route_obj, dep)


from .iceberg_engine import get_all_icebergs_with_trajectories


@app.get("/api/ports")
async def search_ports(q: str = Query(default="", max_length=64)):
    return app.state.datastore.search_ports(q)


@app.get("/api/geocode")
async def geocode(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180)):
    return app.state.datastore.reverse_geocode(lat, lon)


@app.get("/api/ecas")
async def ecas():
    return app.state.datastore.ecas_geojson()


@app.get("/api/chokepoints")
async def chokepoints():
    return app.state.datastore.chokepoints_geojson()


@app.get("/api/icebergs")
async def icebergs(
    startTime: str = Query(default=""),
    endTime: str = Query(default=""),
    stepHours: float = Query(default=1.0, gt=0, le=24),
):
    from datetime import timedelta
    dep_start = _parse_departure(startTime)
    if endTime:
        dep_end = _parse_departure(endTime)
    else:
        dep_end = dep_start + timedelta(days=7)
    try:
        from .model_bridge import icebergs_with_trajectories_real
        return icebergs_with_trajectories_real(dep_start, dep_end, step_hours=stepHours)
    except Exception as exc:  # noqa: BLE001 - degrade, never 500 the map
        logger.warning("drift model unavailable, using mock icebergs: %s", exc)
        return get_all_icebergs_with_trajectories(dep_start, dep_end, step_hours=stepHours)


@app.get("/api/sea-ice")
async def sea_ice(date: str = Query(default="")):
    """Sea-ice concentration from the trained U-Net+ConvLSTM forecaster.

    Falls back to the synthetic field only if the model artifacts are absent,
    so the map still renders rather than erroring.
    """
    try:
        from .model_bridge import sea_ice_geojson_real
        return sea_ice_geojson_real(date or None)
    except Exception as exc:  # noqa: BLE001 - degrade, never 500 the map
        logger.warning("sea-ice model unavailable, using synthetic field: %s", exc)
        from .sea_ice import sea_ice_geojson
        out = sea_ice_geojson()
        for f in out["features"]:
            f["properties"]["source"] = "synthetic (model unavailable)"
        return out


@app.get("/api/ocean-currents")
async def ocean_currents(date: str = Query(default="")):
    """Real GLORYS12 surface currents; synthetic field only as a fallback."""
    try:
        from .model_bridge import ocean_currents_geojson_real
        return ocean_currents_geojson_real(date or None)
    except Exception as exc:  # noqa: BLE001
        logger.warning("currents data unavailable, using synthetic: %s", exc)
        from .environment_layers import ocean_currents_geojson
        out = ocean_currents_geojson()
        for f in out["features"]:
            f["properties"]["source"] = "synthetic (data unavailable)"
        return out


@app.get("/api/wind")
async def wind(date: str = Query(default="")):
    """Real ERA5 10 m wind; synthetic field only as a fallback."""
    try:
        from .model_bridge import wind_geojson_real
        return wind_geojson_real(date or None)
    except Exception as exc:  # noqa: BLE001
        logger.warning("wind data unavailable, using synthetic: %s", exc)
        from .environment_layers import wind_geojson
        out = wind_geojson()
        for f in out["features"]:
            f["properties"]["source"] = "synthetic (data unavailable)"
        return out


@app.get("/api/ice-risk")
async def ice_risk(date: str = Query(default=""), polarClass: str = Query(default="PC4")):
    """IMO POLARIS navigational ice risk, derived from the SIC forecast."""
    from .model_bridge import ice_risk_geojson_real
    return ice_risk_geojson_real(date or None, polar_class=polarClass)


@app.get("/api/weather-heatmap")
async def weather_heatmap():
    from .environment_layers import weather_heatmap_geojson
    return weather_heatmap_geojson()