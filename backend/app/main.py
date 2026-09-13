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


@asynccontextmanager
async def lifespan(app: FastAPI):
    store = Datastore()
    mask = LandMask()
    # The 0.5° land grid erases real narrow straits (Dardanelles, Palk …) and
    # every artificial waterway, splitting otherwise-connected seas. Re-open a
    # chain corridor along the same chokepoint / canal reference lines used for
    # crossing detection so the graph and the render line stay connected.
    for cp in store.chokepoints:
        if cp["kind"] == "strait" and cp["line"]:
            mask.carve_water([(lat, lon) for lon, lat in cp["line"]])
    for w in store.waterways:
        mask.carve_water(build_waterway_midline(w))
    engine = RouteEngine(mask, store.ecas, store.chokepoints, waterways=store.waterways)
    app.state.datastore = store
    app.state.engine = engine
    app.state.booted = True
    print("[api] ready", flush=True)
    yield


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
        return engine.compute_route(
            [w for w in req.waypoints],
            speed_knots=req.speedKnots,
            departure_time_utc=dep,
            optimize_for=req.optimizeFor or "distance",
            vessel_type=req.vesselType,
            draft_meters=req.draftMeters,
            ice_class=req.iceClass,
        )
    except RouteError as exc:
        raise HTTPException(422, str(exc)) from exc


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