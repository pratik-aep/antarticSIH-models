# Ship Route Planner — Build Specification

## 1. What we're building

A web app where a user picks two or more waypoints (ports, coordinates, or points in open ocean/ice), sets a vessel speed and departure time, and gets back a sea route rendered on a map plus a results panel: distance, duration, ETA, and any notable crossings (capes, straits, canals).

Reference UI (attached screenshot, a VesselFinder-style planner):

- Full-bleed map on the left.
- Right sidebar, ~350–400px wide, with tabs **Planner** / **Settings**.
- Numbered origin/destination rows, each with a country flag + place name, "⋮" drag handle between them, and an **"+ Add new point"** button below for multi-leg routes.
- **Speed** slider (1–24 kn) with the current value shown as a chip.
- **Departure time (UTC)** input.
- **Result** block: Distance (nm), Distance in ECA (nm), Duration, Estimated Arrival (UTC), Crossing (named list, e.g. "Cape Good Hope", "Sunda strait").
- Route is drawn as a directional arrowed polyline (chevrons pointing toward destination), curved to follow a sea-going path around landmasses, with numbered pin markers at each waypoint.
- Orange outlines on the base map = Emission Control Areas (ECA) — decorative in v1, functional once we compute distance-in-ECA.
- Standard map chrome: zoom controls, layer/basemap toggle, scale bar bottom-left.

Build this UI, then wire it to a real route engine underneath (not just decoration).

## 2. Scope for v1

Must handle **India → Antarctica**, which is the hard case that should shape the architecture from day one:

- No ports at the destination — Antarctica routing must accept a **free coordinate** or a **research station** (e.g. Bharati, Maitri) as an endpoint, not just a geocoded port.
- Route must cross open Southern Ocean, is likely to run near/through ice-edge zones, and has no canal/strait shortcuts — mostly great-circle-ish sailing with land (Africa/Australia landmass, or via Sunda-type straits) avoidance only near the Indian coastline and any islands en route.
- Great circle distances at high latitude behave very differently from equatorial routes (convergence toward the pole) — the distance/route math must be geodesic-correct, not flat-earth/equirectangular.

So: don't hardcode a "port-to-port" assumption anywhere. Endpoints are just `{name, lat, lon}` — a port lookup is one way to produce that struct, not the only way.

## 3. Suggested stack

- **Frontend**: React + a map library — MapLibre GL JS (open-source, vector tiles, no licensing headache) or Leaflet if simplicity matters more than 3D/perf. Recharts not needed here.
- **Backend**: Node/TypeScript or Python (FastAPI) service exposing a `/route` endpoint. Route computation is CPU-bound pathfinding — either is fine; Python has better geospatial libraries (Shapely, GeoPandas, searoute) if going that way.
- **Basemap tiles**: any OSM-based vector/raster tile provider (MapTiler, Stadia Maps, or self-hosted OSM tiles). Attribution required per provider ToS.
- **Land/ocean mask**: Natural Earth or OSM coastline polygons, simplified, for land-avoidance pathfinding.
- **Port/place geocoding**: a static ports database (e.g. World Port Index / UN/LOCODE) for the search-by-name boxes, with lat/lon + a country flag code per entry.

## 4. Core data model

```
Waypoint {
  id: string
  label: string          // "Abaetetuba", "Bharati Research Station", or "62.1S 74.2E"
  countryCode?: string    // ISO 3166-1 alpha-2, for the flag icon; omit for open-ocean points
  lat: number
  lon: number
  isPort: boolean
}

RouteRequest {
  waypoints: Waypoint[]   // ordered, length >= 2
  speedKnots: number      // 1–24 per UI, but don't hard-clamp server-side
  departureTimeUTC: string // ISO 8601
}

RouteLeg {
  from: Waypoint
  to: Waypoint
  path: [lat, lon][]      // dense polyline points along the sea route for this leg
  distanceNm: number
  distanceInEcaNm: number
  durationHours: number
  crossings: string[]     // named straits/capes/canals this leg passes
}

RouteResult {
  legs: RouteLeg[]
  totalDistanceNm: number
  totalDistanceInEcaNm: number
  totalDurationHours: number
  etaUTC: string
  crossings: string[]     // deduped, ordered
}
```

## 5. Route computation (the actual hard part)

Do this in stages — don't try to build a full weather-routing engine on day one.

**Stage A — Geodesic base route.**
Compute the great-circle path between consecutive waypoints (Vincenty or Haversine-on-WGS84 is fine; at Antarctic latitudes prefer Vincenty for accuracy). Sample it into a polyline every ~20–50nm so it renders as a smooth curve on the map, matching the chevron style in the screenshot.

**Stage B — Land avoidance.**
Check the great-circle polyline against a coastline/land polygon layer. Where it intersects land:
- Route around it using a visibility-graph or A* over a simplified navigable-water grid, biased to hug the coast/known shipping lanes only enough to clear land, then rejoin the great circle.
- A pragmatic approach many route planners use: precompute a graph of "sea nodes" on a coarse lat/lon grid (e.g. 0.5°) marked navigable/blocked from the coastline polygons, run A* with geodesic edge weights, then simplify/smooth the resulting path (e.g. Douglas-Peucker + spline) so it doesn't look grid-like.
- For the India→Antarctica case specifically, the Southern Ocean has almost no land to avoid — so this stage should degrade gracefully to "just the great circle" when nothing is in the way, rather than forcing a detour.

**Stage C — Known chokepoints / crossings.**
Maintain a small reference table of named chokepoints (capes, straits, canals) as polygons or line-crossings: Cape of Good Hope, Cape Horn, Sunda Strait, Malacca Strait, Suez Canal, Panama Canal, Gibraltar, Bab-el-Mandeb, etc. After the path is computed, check which of these the polyline crosses and list them in order — this drives the "Crossing" field in the results panel.

**Stage D — ECA distance.**
Load Emission Control Area polygons (Baltic, North Sea, North American, US Caribbean — published by IMO). Intersect the route polyline against them and sum the length of segments inside any ECA polygon → `distanceInEcaNm`. These are the orange outlines in the screenshot's basemap.

**Stage E — Time/ETA.**
`durationHours = distanceNm / speedKnots`. `eta = departureTime + duration`. Trivial once distance is known — no currents yet, so this is a straight-line speed assumption (see Phase 2).

## 6. API surface

```
POST /api/route
  body: RouteRequest
  returns: RouteResult

GET /api/ports?q=<search text>
  returns: Waypoint[]   // for the autocomplete search boxes, ports only

GET /api/geocode?lat=&lon=
  returns: Waypoint     // reverse lookup for a dropped pin / typed coordinate, for non-port points like Antarctic stations or open ocean
```

Keep route computation stateless and server-side so the land-avoidance graph and ECA polygons don't have to ship to the browser.

## 7. Frontend components

- `<RoutePlannerPanel>` — the right sidebar: tabs, waypoint list, speed slider, departure time picker, results block.
- `<WaypointRow>` — flag + editable name input + drag handle; backed by the `/ports` autocomplete and reverse-geocode for map-click input.
- `<MapView>` — basemap + ECA polygon overlay + route polyline with directional arrow styling + numbered waypoint markers; click-to-add-waypoint support.
- `<ResultsPanel>` — renders `RouteResult` fields exactly as in the screenshot layout.

State: keep `waypoints[]`, `speedKnots`, `departureTimeUTC` in a single planner store (Zustand/Redux/just React context — pick one, don't overbuild); recompute route on any change, debounced.

## 8. Phase 2 (explicitly deferred, but design for it now)

You said ocean currents and similar data are coming later. To make that a clean add rather than a rewrite:

- Keep Stage E (time/ETA) as its own isolated function that takes `(path, speedKnots, departureTime)` and returns timing. Later, swap it for a function that also takes a **current/wind vector field** (e.g. from NOAA OSCAR currents or Copernicus Marine data, gridded lat/lon/time → vector) and integrates effective speed-over-ground segment by segment instead of assuming constant speed. This changes the *duration* calc, not the *distance* calc — keep those concerns separate in the code now.
- Store the environmental field as its own service/layer (`/api/currents?bbox=&time=`) so it can be swapped or disabled independently of routing.
- Once currents exist, "fastest route" and "shortest route" diverge — leave a `optimizeFor: "distance" | "time"` field on `RouteRequest` even if only `"distance"` is implemented in v1.
- Same pattern will apply to ice-edge data for the Antarctic leg (e.g. avoid computed ice extent, seasonal), sea state/weather routing, and fuel-consumption curves later — all as additional vector/scalar fields keyed by lat/lon/time, layered on top of the same base route.

## 9. Milestones

1. Static map + hardcoded two-point great-circle line + results panel wired to real math (no land avoidance yet).
2. Port search/autocomplete + multi-waypoint UI (add/reorder/remove) matching the screenshot.
3. Land-avoidance routing (Stage B) validated on a coastal case (e.g. Rotterdam → Singapore) and a polar case (India → Antarctica) to confirm it doesn't break on sparse-land oceans.
4. Chokepoint crossings + ECA distance (Stages C, D).
5. Phase 2: currents/ice layer integration per §8.

## 10. Open questions to resolve with the user before/while building

- Which basemap/tile provider and attribution are acceptable (licensing/cost)?
- Preferred backend language (Node/TS vs Python) — affects which geospatial libraries are used.
- Source for the ports database and for Antarctic station coordinates.
- Whether "route optimization" in v1 should ever deviate from a great circle for reasons other than land (e.g. avoiding a specific strait), or if that's strictly phase 2.