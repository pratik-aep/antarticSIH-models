# Stage 3 prompt — land avoidance, chokepoints, ECA, wired to the client

Paste this to the agent working on the route planner codebase, once Stage 2 (straight geodesic line, working scroll, working live redraw) is confirmed working.

---

Stage 2 gave every leg a pure geodesic (great-circle) line and left `distanceInEcaNm = 0` and `crossings = []` as stubs. This stage fills those in for real: land-avoidance routing (Stage B/C/D from the original spec), and wiring the real results into the UI that's already built for it (the results panel already has Distance/ECA/Crossing rows — they just need real data instead of stubs).

Do this server-side, not in the browser — the land mask, sea-node graph, and ECA polygons are too heavy to ship to the client and recompute per request. The client just sends waypoints and renders whatever polyline + metadata comes back.

## 1. Land/sea navigability grid

- Load a coastline/land polygon dataset (Natural Earth 1:10m or OSM coastlines, simplified — full-resolution coastlines will make the graph unusably dense).
- Build a coarse lat/lon grid (start at 0.5°, tune later) and mark each node navigable (sea) or blocked (land) by point-in-polygon test against the coastline data.
- Precompute this once at startup/build time and cache it — don't rebuild the grid per request.
- Note the Southern Ocean legs (India→Antarctica) will have almost no blocked nodes; the grid must degrade to "basically the geodesic line" there rather than forcing a detour through open water for no reason.

## 2. Pathfinding

- For each leg, first check: does the Stage-2 geodesic line intersect any land polygon? If no → use the geodesic line as-is, skip pathfinding entirely (this keeps the Southern Ocean / open-water case cheap and visually identical to Stage 2).
- If yes → run A* (preferred over plain Dijkstra for the geographic heuristic — use geodesic distance-to-goal as the heuristic) over the sea-node grid from the leg's start to end node, with blocked nodes excluded and edge weights = geodesic distance between adjacent nodes.
- Post-process the raw grid path: simplify (Douglas-Peucker) then smooth (spline or similar) so it doesn't look like a staircase of grid cells — it should read as a natural curve that just clears the coastline, matching the arrowed-polyline look in the reference screenshot.
- Keep this whole thing as an isolated function — `(startNode, endNode, grid) -> polyline` — that slots in alongside the Stage 2 geodesic function inside the per-leg route builder, rather than replacing it. The per-leg function's job becomes: try geodesic, fall back to A* if blocked.

## 3. Chokepoint crossings

- Maintain a small reference table of named chokepoints as line-crossings or polygons: Cape of Good Hope, Cape Horn, Sunda Strait, Malacca Strait, Suez Canal, Panama Canal, Strait of Gibraltar, Bab-el-Mandeb, Strait of Hormuz — this can be a static JSON file, doesn't need a database.
- After a leg's final polyline (geodesic or A*) is computed, test which of these it crosses (line-segment intersection for line-based chokepoints, polygon intersection for area-based ones like a canal).
- Collect crossings per leg, then dedupe and order them across the full multi-leg route for the top-level `crossings` field.

## 4. ECA distance

- Load the IMO Emission Control Area polygons (Baltic, North Sea, North American, US Caribbean).
- Intersect the final route polyline against these polygons and sum the length of the segments that fall inside any ECA → this is `distanceInEcaNm`.
- Same pattern as chokepoints: compute after the final path is known, not before, since A*-adjusted paths can enter/exit an ECA differently than the raw geodesic would have.

## 5. API contract changes

`RouteLeg` and `RouteResult` already have `distanceInEcaNm` and `crossings` fields per the original spec — no schema change needed, just stop hardcoding them to `0`/`[]` and return the real computed values. Confirm the response shape is otherwise unchanged so the client doesn't need parsing changes, only rendering changes (below).

## 6. Client wiring

- The map should render whatever `path` comes back per leg — no client-side branching between "geodesic mode" and "avoidance mode"; the server already decided which one applies per leg, the client just draws points.
- Results panel: replace the stubbed `0 nm` / empty crossings list with the real values from the response — this is likely already correctly wired from Stage 1/2's data flow, just confirm it renders a populated list correctly (multiple crossings, proper comma/line formatting) and not just the empty-state.
- No new UI components should be needed this stage — this is a data-correctness stage, not a UI stage.

## Acceptance criteria

- [ ] A route with no land in the way (e.g. India → Antarctica coordinate) renders identically to Stage 2's output — confirms the "skip pathfinding when unobstructed" path works and didn't regress.
- [ ] A route where the straight geodesic line would cross land visibly bends around it — good test: a route from India's west coast to India's east coast that would naively cut across the subcontinent, or Mumbai → Colombo which should clear Sri Lanka's coastline rather than cutting through it.
- [ ] A route through a known chokepoint (e.g. anything routed via the Gulf of Aden/Red Sea) shows the correct named crossing(s) in the results panel, not an empty list.
- [ ] A route through a known ECA (e.g. a leg through the North Sea or Baltic) shows a non-zero `Distance in ECA` that's less than or equal to total distance, and zero for routes that never enter one (confirm the India→Antarctica case still correctly shows 0).
- [ ] Grid/pathfinding computation doesn't noticeably stall the UI — if it's slow, cache computed leg paths per unique waypoint pair rather than recomputing on every minor UI interaction (e.g. speed slider drags, which don't change the path at all).

Once these are confirmed, currents/ice-edge data (Phase 2 in the original spec) is the natural next stage — it only affects duration/ETA on top of whatever path this stage produces, not the path itself.