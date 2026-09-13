# Routing Algorithm — Handoff Document

Owner-oriented write-up for anyone continuing work on the sea-route planner.
Covers the pipeline, the A* engine, the post-processing, data files, operations,
testing, known gotchas and open items. Read this before touching anything.

---

## 1. What the system does

Given a list of waypoints (ports or arbitrary coordinates), `POST /api/route`
returns, per leg:

- `path` — dense polyline of `[lat, lon]` pairs that never crosses land
  (at the model's 0.5° resolution), resampled to ~20 nm spacing, smoothed with
  Chaikin corner-cutting, with artificial canals spliced in where used.
- `distanceNm` — geodesic length of the real returned path (always equals the
  displayed distance).
- `distanceInEcaNm` — length inside Emission Control Area polygons.
- `crossings` — named straits/canals/capes the path transits, in order.
- `durationHours` / `etaUTC` — time = distance / speed (pure kinematics; see
  Phase-2 notes at the end).

Waypoints can be ports (autocomplete) or any lat/lon (map-click / typed
coords). No origin/destination constraints — routing is undirected per leg.

---

## 2. High-level pipeline (one leg)

Implemented in `backend/app/route_engine.py` (`_leg_path`, `compute_route`).

| Stage | Name | What it produces |
|-------|------|------------------|
| A | Geodesic base | `_gc_path`: straight Vincenty-sampled line a→b at 20 nm |
| B | Land avoidance | `_land_avoid_path`: A* over the water grid + repair/flatten smoothing |
| C | Crossing detection | `_crossings`: shapely intersection of path vs chokepoint lines |
| D | ECA distance | `_eca_distance`: shapely intersection of path vs ECA polygons |
| E | Time / ETA | `duration_hours`: distance/speed, ETA from departure |

Shortcut: if the straight geodesic `_gc_path` is already land-free
(`_check_free`), Stage B is skipped entirely and Stage A's clean line is used
(open-ocean legs like Singapore→Colombo or Athens→Jeddah get the direct
geodesic, which is why those are fast and smooth).

### Stage B in detail (`_land_avoid_path`)

```
endpoints   nearest_water(a) and nearest_water(b)      ("snap to water")
A*          GridRouter.shortest_path(sa, sb)           cell-centre path
centerline  interior = centers[1:-1]  (drop the port seams)
DP          _douglas_peucker(interior, eps=1.1)        reduce A* staircase
shortcut    _shortcut_water(DP)                        greedy geodesic jumps
repair      _ensure_safe(..., centers)                 splice back cells on land-crossings
smooth      _smooth_safe(reduced, mask)                Chaikin, land-validated, with fallback
resample    _resample(reduced, 20.0)                   uniform ~20 nm spacing
stitch      [a, ...interior, b]  (dedupe consecutive)  final leg path
```

`_check_free(pts, mask, step_nm=5.0)` is the invariant everywhere: a polyline is
accepted only if **every** sampled point (5 nm apart, denser than the grid)
falls in a water cell. When measuring a *full* leg (ports included) this is
always `False` because ports sit inside land cells — the port→first-water seam
is a land crossing. **All land-safety assertions must test `path[1:-1]`.**

---

## 3. The grid: `LandMask` (`backend/app/mask.py`)

- 0.5° cell size. `NROWS=360`, `NCOLS=720`, `SPACING=0.5`.
- Cell top-left anchored: `LAT_TOP = 89.75`, `LON_LEFT = -179.75`.
- A cell is **land** when its centre is inside a Natural Earth 1:110m land
  polygon (`data/ne_110m_land.geojson`), built at boot (~1 s) with shapely
  vectorized-in-chunks `contains`.
- `cell(lat, lon)` → bool land (rounds to nearest centre).
- `nearest_water(lat, lon, max_radius=None)` → myopic ring search up to 14 cells
  for the nearest water cell centre; `_land_avoid_path` snaps each endpoint here
  and logs a `[route] large waypoint snap` warning when the snap is > 30 nm.
  Returns `None` if nothing found → `RouteError('... is not reachable from
  navigable water')`.

### Critical consequence of 0.5° resolution
Real narrow straits **wider than zero cells** get erased: the centre-point test
makes a strait a single-cell-thick land sliver, splitting one sea into two
disconnected graph components → "enclosed sea" / `no navigable water route found`.
Applies to Dardanelles, Palk Strait, and every artificial canal (Suez, Panama,
…).

**Mitigation — `carve_water(polyline_latlon)`**:
forces a water corridor along a reference polyline. Cells inside a 3×3 belt
around the line are converted to water **only while chain-adjacent to existing
water** (`_touches_water`, orthogonal neighbours only) — so a corridor floating
over a solid landmass is a no-op, not an underground tunnel. Iteratively
floods the belt.

`main.py` lifespan carves: every chokepoint with `kind=="strait"` + every
waterway midline, **then** builds the engine. Order matters — carve before
`GridRouter` construction.

---

## 4. The A* engine: `GridRouter` (`route_engine.py:49`)

- Nodes = water cell centres. Start/goal = snapping of the posted endpoints.
- Move set: 4 orthogonal + 4 diagonal neighbours, lon-wrapped (`% NCOLS`).
- Edge cost: exact haversine between cell centres (metres).
- Heuristic: haversine to goal (admissible → optimal for a static graph).
- Non-convergence guard: `closed > 800000` → error.
- **`A_STAR = True`** module flag (clean toggle if you ever need Dijkstra).

### Three hard constraints in the neighbour loop
1. **Arctic ice cap**: no cells north of `nav_top_lat = 78°` — the graph is
   simply not navigable above it, so the model can't cheat a transpolar
   shortcut between Atlantic and Pacific.
2. **Arctic meander penalty**: cells above `arctic_pen_lat = 65°` (northern
   hemisphere only) get `+ 0.2 * d² nm` added to edge cost, so far-north
   meanders lose to low-latitude shipping lanes but genuine high-latitude
   routes (e.g. Antarctic legs are unpenalised) still work.
3. **Diagonal land-corner rule** (added after a real bug): a diagonal move
   from `(r,c)` to `(r±1,c±1)` passes through the shared corner of a 4-cell
   block. If **either** axis-adjacent cell is land, the move is rejected —
   the geodesic between the two centres would clip that land corner. The rule
   must check **either** (not "both"); the older "both" variant still allowed
   diagonal grazes of a coast and produced `A* centers land-free: False` on
   legs threading the Japanese archipelago (see §Known bugs).

Every returned A* centerline is guaranteed land-free by construction for these
3 rules; `_check_free(centers)` is the regression guard.

### Waterway shortcut edges (artificial canals)
`GridRouter(mask, waterways=())` builds one bidirectional shortcut edge per
waterway:
- endpoints `nearest_water(from)`, `nearest_water(to)` (`max_radius=8`); skipped
  with a log line if they land on the same cell or have no near water.
- cost = `polyline_length_nm(midline) * NM_TO_M` — the **real** canal+gulf
  length, in metres, matched to the metre-valued grid edges.
- `waterway_lines[(iA,iB)]` keeps the midline so that when the search chooses
  that edge, the canonical midline (`midline[1:-1]`) is **spliced into the
  returned polyline** at reconstruction. Rendering, crossing detection and ECA
  then all see the actual canal geometry instead of a straight grid hop.

`build_waterway_midline(w, step_nm=6.0)` chains `from → via… → to` into a dense
geodesic polyline used for the edge cost, the splice geometry, and the mask
carve.

---

## 5. Post-A* geometry functions (`route_engine.py`)

- `_douglas_peucker(pts, eps=1.1)` — collapse the A* staircase to a corridor.
- `_shortcut_water` / `_safe_shortcut` — greedy merge of collinear water
  segments into geodesic jumps; validation re-checks **both** that the jump
  never enters a land cell and never goes north of `max_north_lat=78`.
  `_safe_shortcut` samples at `0.6 * SPACING` (≈ 0.3 nm) — very conservative.
- `_ensure_safe(pts, original_path, mask)` — for each consecutive pair whose
  geodesic crosses land/ice, splice back the *original* A* cell vertices found
  via `original_path.index(p/q)`. **Gotcha:** index lookup only matches cell
  centres; pairs whose endpoints are already-smoothed interpolations fall back
  to `i=j=-1` and get no splice. This is why in legacy runs the *final* cursor
  still had land grazes — `_ensure_safe` ran before smoothing. The diagonal-
  corner rule (§4.3) is what actually keeps the end-to-end path clean today.
- `_chaikin(pts, iterations)` — corner cutting: per segment `Q=25%`, `R=75%`,
  **appended in that order**. Emitting `R` then `Q` was a historical bug that
  zigzagged the curve and inflated distances ~2.5× (Parangipettai→Bharati read
  12,013 nm instead of 4,868 nm) — see Known bugs.
- `_smooth_safe(pts, mask, fallback=None)` — try Chaikin×2, then Chaikin×1,
  then the unsmoothed line; return the first that is `_check_free`. A
  land-crossing artificial curve is never returned.
- `_resample(pts, 20.0)` — uniform ~20 nm spacing along the geodesics; the
  returned leg lives at this density (126–609 pts depending on length).

**Pipeline invariant nobody should break:** after every transform, the
interior polyline must still pass `_check_free` at 5 nm. If you add a new
transform, run it through `_smooth_safe`-style validation or prove it
preserves water-clearance.

---

## 6. Crossings & ECA

`_crossings(path)` builds a shapely `LineString(lon,lat)` and intersects with
chokepoint geometry:

- `kind=="cape"` (Cape of Good Hope, Cape Horn): `Point` + `radiusNm`; hit when
  geodesic distance(point, line) ≤ radius. Projected to sort along the route.
- `kind=="strait"/"canal"` (everything else): `LineString` throat. GeoPoint
  intersection when it crosses cleanly; otherwise falls back to a
  **tolerance band** `STRAIT_TOL_DEG = 0.4°`: counts a transit when the route
  runs within 0.4° of the line (the 0.5° grid channel can sit up to ~half a
  grid diagonal from the hand-placed throat). Crossing is placed at `line.project(
  centroid)` for ordering. The order follows route progress; duplicates removed,
  deduped across legs.

`_eca_distance(path, eca_polys)` intersects the polyline with each ECA polygon
and sums geodesic lengths of the intersection; incomplete ring fixes via
`buffer(0)`; MultiPolygons are flattened.

Distance/ECA always derive from the same `path` that's plotted, so the UI's
displayed numbers match the drawn line by construction.

---

## 7. Data files (`backend/data/` — edit JSON, restart backend)

| File | Contents |
|------|----------|
| `ports.json` | NGA World Port Index. `name`, `aliases[]`, `lat`, `lon`, `isPort`, `countryCode`. `search_ports` does substring ranking (prefix first), `reverse_geocode` finds stations <120 nm / ports <8 nm. |
| `ne_110m_land.geojson` | Natural Earth land polygons → the mask. |
| `ecas.json` | `{"ecas":[{name, type, polygons:[[ [lon,lat]… ]] }]}`. |
| `chokepoints.json` | `{"chokepoints":[{name, kind, line?:[[lon,lat]… ], point?, radiusNm?}]}` — see below. |
| `waterways.json` | `{"waterways":[{name, from:[lat,lon], via?:[[lat,lon]…], to:[lat,lon]}]}` — artificial canals. |

Current named chokepoints (13):
`Suez Canal, Strait of Gibraltar, Bab el-Mandeb, Strait of Hormuz, Malacca
Strait, Sunda Strait, Torres Strait, Cape of Good Hope, Cape Horn, Panama
Canal, Dardanelles, Bosphorus, Palk Strait`.
Waterways (3): `Suez Canal, Panama Canal, Kiel Canal`.

**To add a strait** (e.g. a future Chirikov attack): add a `kind:"strait"`
entry with a `line` threaded through the real throat, add it to the include in
`carve_water` if it's below grid resolution, restart. **To add a canal**: add a
waterway with `from`/`via`/`to` (lat,lon); `_build_waterways` auto-snaps
endpoints, so just restart.

Note `chokepoints_geojson` renders straits as real `MultiPoint`-ready arrays —
the old single-pair format silently broke the map overlay fixture; every
`line` field today is `[list(pt) for pt in cp["line"]]`.

---

## 8. Running it

- Backend: FastAPI/uvicorn on `127.0.0.1:8600` — **no `--reload`**, so every
  code change requires a full restart (uvicorn runs in-process, mask builds
  once, engine is in `app.state`).
- Frontend: Vite dev server (in practice binds either `:5173` or `:5174`; check
  `/tmp/planner_vite.log` — port drift is normal), keyed to `:8600`.
- `../start.sh` starts both and tails logs into `/tmp/planner_api.log` /
  `/tmp/planner_vite.log`.
- Restart pattern used during known-good verification:
  `kill` all start.sh/uvicorn/vite pids, then from `backend/`
  `nohup ../start.sh > /tmp/startsh_stage4.log 2>&1 & disown`.
- The project root path contains a trailing space — **quote paths** in every
  shell/terminal command and use `workdir` instead of `cd`.

### API
- `POST /api/route` `{waypoints:[{id,label,lat,lon,isPort}], speedKnots,
  departureTimeUTC, optimizeFor}`
- `GET /api/ports?q=` · `GET /api/geocode?lat=&lon=` · `GET /api/ecas` ·
  `GET /api/chokepoints` · `GET /api/health`
- Errors: `400/422` with a `RouteError`/validation message surfaced to the UI.

---

## 9. Testing / acceptance

Stage docs live in the repo root (`stage2.md` … `stage4.md`). The acceptance
harness scripts used during development live in
`/var/folders/…/T/opencode/routecheck/` (acc4.py / acc_smooth2.py /
trace_pipeline.py / check_ui_s4.mjs …); move them into the repo if the team
wants to keep them.

Current verified baseline (Stage 4, post diagonal-fix):

| Test | nm | Crossings |
|------|----|-----------|
| Tuticorin→Kankesanturai (Palk) | 127.1 | Palk Strait |
| Izmir→Istanbul (Dardanelles) | 304.6 | Dardanelles, Bosphorus |
| As Suways→Alexandria (Suez) | 260.8 | Suez Canal |
| Athens→Jeddah (Med→Red) | 1325.6 | Suez Canal |
| Mumbai→Bandar Abbas (Hormuz) | 1067.5 | Strait of Hormuz |
| San Diego→New York (Panama) | 5086.3 | Panama Canal, ECA 330.5 |
| Mumbai→Rotterdam | 7291.7 | Bab el-Mandeb, Suez Canal, Gibraltar |
| Singapore→Colombo | 1697.6 | Malacca Strait |
| Parangipettai→Bharati* | 4875.7 | Palk Strait |

\* Southern-ocean long-haul, now routed by A* (geodesic is not land-free).

Land-safety checks must test **`path[1:-1]`** (see §2). Smoothness gate:
interior free + max turn angle modest (≈13° on the Mumbai→Chennai example).

---

## 10. Known bugs / open items (carry-forward for the team)

1. **`_ensure_safe` index mismatch** — only concerns pre-validation pairs; when
   smoothing happens after, the splice targets don't match. Currently covered by
   the diagonal-corner rule; do **not** over-narrow the diagonal rule back to
   "both cells" without re-running the Japan-archipelago legs.
2. **Dardanelles crossing detection nuance** — the route took
   `[Dardanelles, Bosphorus]` on the current grid, but a route that threads the
   corridor slightly east of the new 4-pt Dardanelles line trips only Bosphorus.
   Acceptance reads "Dardanelles, Bosphorus, or both"; satisfied, but not
   symmetric.
3. **Kiel Canal never used** on probed routes (Rotterdam→Gothenburg,
   Copenhagen→Hamburg) because Skagerrak/Denmark-straits are navigable at 0.5°
   and cheaper. The canal edge exists but isn't selected; confirm intended
   behaviour before adding acceptance that requires it.
4. **Hamburg→Antwerp ECA drift** — measured 236–241 nm vs an older 664 nm
   figure in stage 3 notes; likely a path/measurement change, but verify
   against the intended fixture.
5. **Always sets `land free` False on the whole leg** if you include endpoints
   (ports are in land cells). Do not "fix" this by carving ports to water —
   that then mis-snaps `nearest_water` and can create tunnels from land.
6. **`nearest_water` max_radius**: straits/corridors thinner than the search
   band can return a far-neighbour cell; the `>30 nm snap` log is the tripwire.
   `carve_water` corridors are belt-1-wide and should be re-verified whenever a
   chokepoint is added.
7. **`optimizeFor="time"` is wired but delegates to distance** (UI disables it,
   labelled "needs weather/currents — phase 2").

---

## 11. Phase-2 direction (from the about-box + product intent)

- **Finer grid** would resolve straits/canals natively and shrink the
  `carve_water` / `STRAIT_TOL_DEG` crutches — the biggest accuracy win.
- **Current/weather-aware ETA**: replace Stage E's kinematic guess; keep it
  isolated (`duration_hours` is the swap point).
- **Path optimization objectives**: `optimizeFor="time"` is currently a stub;
  implement as cost = f(wind/current) inside the A* edge cost.
- **Dynamic waterways**: canal closures/availabilities; the waterway-edge cost
  is a static scalar today.

---

## 12. Style / conventions

- Pure-python geodesics in `geo.py` (Vincenty + haversine) — no external math
  deps; keep new geometry there.
- Single module per concern (mask / geo / datastore / route_engine / main).
- Log noisy-but-useful diagnostics with `[route]`/`[mask]` prefixes
  (`flush=True`), since the engine holds state across requests and the A* logs
  are the main debugging window (large snaps, waterway loads, convergence).
- Guard rails: alphabetical domains above are all internal; the **public**
  invariants are "path never crosses land (interior)", "distance matches the
  drawn path", "crossings in order".