# Routing Algorithm — Handoff Document

Owner-oriented write-up for anyone continuing work on the sea-route planner.
Covers the pipeline, the A* engine, post-processing, data files, operations,
testing, known gotchas, open items, and an **exhaustive file-by-file developer blueprint** for algorithm improvements. Read this before touching anything.

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
   shortcut between Atlantic and Pacific. (Bypassed for polar/icebreaker vessels).
2. **Arctic meander penalty**: cells above `arctic_pen_lat = 65°` (northern
   hemisphere only) get `+ 0.2 * d² nm` added to edge cost, so far-north
   meanders lose to low-latitude shipping lanes but genuine high-latitude
   routes still work.
3. **Diagonal land-corner rule**: a diagonal move from `(r,c)` to `(r±1,c±1)`
   passes through the shared corner of a 4-cell block. If **either** axis-adjacent
   cell is land, the move is rejected — the geodesic between the two centres
   would clip that land corner.

Every returned A* centerline is guaranteed land-free by construction for these
rules; `_check_free(centers)` is the regression guard.

### Waterway shortcut edges (artificial canals)
`GridRouter(mask, waterways=())` builds one bidirectional shortcut edge per
waterway:
- endpoints `nearest_water(from)`, `nearest_water(to)` (`max_radius=8`).
- cost = `polyline_length_nm(midline) * NM_TO_M` — the **real** canal+gulf
  length, in metres, matched to the metre-valued grid edges.
- `waterway_lines[(iA,iB)]` keeps the midline so that when the search chooses
  that edge, the canonical midline (`midline[1:-1]`) is **spliced into the
  returned polyline** at reconstruction.

---

## 5. Post-A* geometry functions (`route_engine.py`)

- `_douglas_peucker(pts, eps=1.1)` — collapse the A* staircase to a corridor.
- `_shortcut_water` / `_safe_shortcut` — greedy merge of collinear water
  segments into geodesic jumps; validation re-checks land clearance and ice limits.
- `_ensure_safe(pts, original_path, mask)` — splice back cell vertices for pairs crossing land.
- `_chaikin(pts, iterations)` — corner cutting (emits Q then R to prevent oscillations).
- `_smooth_safe(pts, mask, fallback=None)` — try Chaikin×2, then Chaikin×1, then fallback.
- `_resample(pts, 20.0)` — uniform ~20 nm spacing along the geodesics.

---

## 6. Crossings & ECA

`_crossings(path)` builds a shapely `LineString(lon,lat)` and intersects with
chokepoint geometry (`kind=="cape"` vs `kind=="strait"/"canal"` with `STRAIT_TOL_DEG = 0.4°`).

`_eca_distance(path, eca_polys)` intersects the polyline with each ECA polygon
and sums geodesic lengths of the intersection.

---

## 7. Data files (`backend/data/` — edit JSON, restart backend)

| File | Contents |
|------|----------|
| `ports.json` | NGA World Port Index. `name`, `aliases[]`, `lat`, `lon`, `isPort`, `countryCode`. |
| `ne_110m_land.geojson` | Natural Earth land polygons → the mask. |
| `ecas.json` | Emission Control Area polygons. |
| `chokepoints.json` | Named straits and capes geometry. |
| `waterways.json` | Artificial canal midlines (`from`, `via`, `to`). |

---

## 8. Running it

- Backend: FastAPI/uvicorn on `127.0.0.1:8600` — **no `--reload`** (runs in-process, mask builds once).
- Frontend: Vite dev server on `:5173`.
- Root directory has a trailing space — quote paths in shell commands.

---

## 9. Testing / acceptance baseline

Current verified baseline (Stage 4):
- Tuticorin→Kankesanturai (Palk): 127.1 nm (Palk Strait)
- Izmir→Istanbul (Dardanelles): 304.6 nm (Dardanelles, Bosphorus)
- As Suways→Alexandria (Suez): 260.8 nm (Suez Canal)
- Athens→Jeddah (Med→Red): 1325.6 nm (Suez Canal)
- Mumbai→Bandar Abbas (Hormuz): 1067.5 nm (Strait of Hormuz)
- San Diego→New York (Panama): 5086.3 nm (Panama Canal, ECA 330.5 nm)
- Mumbai→Rotterdam: 7291.7 nm (Bab el-Mandeb, Suez Canal, Gibraltar)

---

## 10. Known bugs / open items

1. `_ensure_safe` index mismatch on smoothed points (mitigated by diagonal rule).
2. Kiel Canal never selected over Skagerrak due to grid cost comparison.
3. Port snapping: `nearest_water` max radius warning on inland port coordinates.

---

## 11. Developer Blueprint: How & Where to Improve the Algorithm

This section is a **file-by-file developer reference** explaining exactly where to modify the codebase to implement key algorithmic improvements.

```
backend/app/
├── mask.py           <-- Grid resolution, land polygons, bathymetry, water carving
├── route_engine.py   <-- A* search, edge cost functions, vessel constraints, post-smoothing
├── geo.py            <-- Geodesic math, spherical/ellipsoidal calculations
├── datastore.py      <-- Port indexing, spatial queries, search acceleration
├── iceberg_engine.py <-- Dynamic hazard prediction & iceberg drift modeling
├── environment.py    [NEW] <-- Weather & ocean current vector field integration
└── main.py           <-- API endpoints, request validation, app lifecycle
```

---

### A. Increase Grid Resolution (Finer Water Mesh)
*Goal: Native resolution of narrow straits/canals without relying heavily on `carve_water` or wide `STRAIT_TOL_DEG` thresholds.*

* **Primary File**: `backend/app/mask.py`
  * **Line 26**: Change `SPACING = 0.5` to `0.25` (15 nm resolution, 720×1440 grid) or `0.1` (6 nm resolution, 1800×3600 grid).
  * **Line 24**: Replace `ne_110m_land.geojson` with high-resolution Natural Earth vector data `ne_10m_land.geojson` in `backend/data/`.
  * **Line 44-63 (`_build_grid`)**: When increasing grid size by 4× or 25×, optimize memory using `numpy` bitpacks or `scipy.ndimage` binary dilation.
* **Secondary File**: `backend/app/route_engine.py`
  * **Line 26**: Adjust `STRAIT_TOL_DEG = 0.4` to scale with `SPACING` (e.g. `STRAIT_TOL_DEG = SPACING * 0.8`).
  * **Line 197 (`closed > 800000`)**: Increase max closed nodes cap to `4000000` for high-resolution grids.

---

### B. Implement Weather & Ocean Current Routing (`optimizeFor="time" / "fuel"`)
*Goal: Account for surface ocean currents (OSCAR/Copernicus), wind resistance (ERA5), and wave height to find true fastest / most fuel-efficient routes.*

* **New File**: `backend/app/environment.py`
  * Create netCDF/GRIB2 reader or pre-processed grid loader returning `(u_current, v_current, u_wind, v_wind, wave_height)` at `(lat, lon, timestamp)`.
* **Primary File**: `backend/app/route_engine.py`
  * **`GridRouter._edge(r1, c1, r2, c2)` (Lines 112-117)**:
    * Calculate bearing between cells `azimuth = geo.vincenty_inverse(...)`.
    * Query current vector `(u, v)` from `environment.py`.
    * Calculate Speed Over Ground: `SOG = vessel_stw + (u * sin(az) + v * cos(az))`.
    * Modify edge cost based on `optimize_for`:
      ```python
      if optimize_for == "time":
          edge_cost = dist_m / max(SOG_m_s, 0.5)
      elif optimize_for == "fuel":
          power_kw = cubic_resistance_model(vessel_stw, wave_height, wind_resistance)
          edge_cost = power_kw * (dist_m / max(SOG_m_s, 0.5))
      else:
          edge_cost = dist_m  # pure distance
      ```
  * **`GridRouter.shortest_path()` (Line 119)**: Pass `optimize_for`, `vessel_speed_knots`, and `departure_time` into heuristic evaluation (`h = distance / max_vessel_speed`).
  * **`RouteEngine.duration_hours()` (Lines 510-512)**: Perform numerical integration along final polyline segments: `t_total = sum(d_i / SOG_i)`.

---

### C. Enforce Vessel Constraints (Draft, Beam, Air Draft & Ice Class)
*Goal: Prevent deep-draft ships (e.g. VLCC tankers) or wide vessels from taking shallow or restricted waterways (e.g. Malacca Strait vs Lombok/Makassar Straits, Panama Canal draft limits).*

* **Primary Data File**: `backend/data/waterways.json`
  * Add restriction metadata to waterway entries:
    ```json
    {
      "name": "Panama Canal (Neopanamax)",
      "from": [9.36, -79.92], "to": [8.88, -79.52],
      "maxDraftMeters": 15.2,
      "maxBeamMeters": 51.2,
      "requiredIceClass": "none"
    }
    ```
* **Primary File**: `backend/app/route_engine.py`
  * **`GridRouter._build_waterways()` (Lines 76-101)**: Store constraint metadata on waterway shortcut edges.
  * **`GridRouter.shortest_path()` (Lines 183-195)**: Inside the waterway neighbor expansion loop:
    ```python
    for nb, wcost, wmeta in self.waterways.get(node, ()):
        if draft_meters > wmeta.get("maxDraftMeters", 999.0):
            continue  # Ship too deep for this canal
        if beam_meters > wmeta.get("maxBeamMeters", 999.0):
            continue  # Ship too wide
    ```
  * **Shallow Water / Bathymetry Avoidance (Lines 167-170)**: Integrate GEBCO bathymetry grid in `LandMask` (`mask.py`). If `bathymetry_depth(lat, lon) < draft_meters + safety_margin`, reject node as impassable land.

---

### D. Dynamic Iceberg & Hazard Avoidance Cost Field
*Goal: Dynamically route vessels around moving icebergs and sea-ice fields based on predicted iceberg drift.*

* **Primary File**: `backend/app/iceberg_engine.py`
  * Implements `generate_trajectory()` and `predict_position()`.
* **Primary File**: `backend/app/route_engine.py`
  * **`GridRouter.shortest_path()`**:
    * Estimate vessel arrival time at cell `(rr, cc)`: `t_cell = departure_time + g[node] / vessel_speed`.
    * Query iceberg locations at `t_cell` via `iceberg_engine.predict_position()`.
    * Calculate distance `d_ice` from cell to nearest iceberg.
    * Add exponential safety repulsion penalty to edge cost:
      ```python
      if d_ice < 50.0:  # within 50 nm of active iceberg
          if ice_class == "none":
              edge += 1000.0 * math.exp(-d_ice / 10.0) * geo.NM_TO_M
          else:
              edge += 100.0 * math.exp(-d_ice / 10.0) * geo.NM_TO_M
      ```

---

### E. Advanced Path Post-Processing & Vessel Turn Kinematics
*Goal: Replace staircase reduction and basic Chaikin smoothing with realistic ship turning circles (Dubins / Reeds-Shepp curves or B-splines).*

* **Primary File**: `backend/app/route_engine.py`
  * **`_chaikin()` (Lines 301-325)**: Replace basic control-point cutting with a constrained B-spline or cubic Hermite spline interpolation.
  * **Turn Radius Enforcement**:
    * Compute turning angle $\theta$ at each waypoint vertex.
    * Enforce maximum rate of turn (ROT): $\text{Radius}_{\min} = \frac{v}{\text{ROT}_{\max}}$.
    * Discard shortcut jumps in `_shortcut_water()` (Line 252) that produce turn angles exceeding ship maneuverability limits ($\theta > 45^\circ$).
  * **`_ensure_safe()` (Lines 267-286)**: Replace exact `index()` lookup with spatial nearest-vertex indexing using `scipy.spatial.KDTree` to avoid index mismatch fallback issues.

---

### F. Emission Control Area (ECA) Cost Optimization
*Goal: Allow ships to optimize routes by trading off extra distance outside ECA zones vs high-cost low-sulfur fuel inside ECAs.*

* **Primary File**: `backend/app/route_engine.py`
  * **`GridRouter.shortest_path()`**:
    * Pre-rasterize ECA polygons (`data/ecas.json`) into `LandMask.eca_grid` bytearray.
    * In neighbor loop, check if cell `(rr, cc)` is inside ECA:
      ```python
      fuel_cost_factor = 1.45 if self.mask.is_eca[nb] else 1.0  # MGO vs HFO price ratio
      if optimize_for == "cost":
          edge *= fuel_cost_factor
      ```

---

### G. Performance & Search Acceleration (C++ / Rust / Numba Engine)
*Goal: Scale A* search performance for real-time multi-vessel simulations or 0.1° high-resolution global grids.*

* **Primary File**: `backend/app/route_engine.py`
  * **Contraction Hierarchies / ALT (A*, Landmarks, Triangle Inequality)**: Precompute landmark distance vectors to prune 90%+ of graph search space.
  * **PyBind11 / Numba Acceleration**: Move `GridRouter.shortest_path()` loop to C++ compiled module or Numba JIT compiler (`@numba.njit`). The 8-neighbor grid traversal runs 50×-100× faster in C++.

---

## 12. Style, Conventions & System Invariants

- **Pure-python geodesics in `geo.py`**: Vincenty + haversine calculations are self-contained without external C-extensions. Keep core mathematical primitives here.
- **Single module per concern**: `mask.py` (raster), `route_engine.py` (graph & path), `geo.py` (math), `datastore.py` (ports), `iceberg_engine.py` (drift & hazards).
- **Console logging conventions**: Prefix diagnostics with `[route]`, `[mask]`, `[iceberg]` with `flush=True`.
- **Public System Invariants**:
  1. **Interior polyline land-safety**: `_check_free(path[1:-1])` must return `True` for every computed route leg.
  2. **Distance consistency**: `totalDistanceNm` must strictly equal the geodesic sum of the polyline coordinates rendered on the frontend map.
  3. **Order preservation**: Chokepoint crossings and ECA intersection distances must follow chronological progression along the route path.