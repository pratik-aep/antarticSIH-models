# Stage 2 prompt — fix bugs, add straight-line geodesic routing

Paste this to the agent working on the route planner codebase.

---

The Route Planner UI is built and matches the target design, but two things are broken and one feature is still missing. Fix in this order:

## 1. Bug: route doesn't render when waypoints are entered

Adding waypoints updates the sidebar list and the results panel numbers, but no line appears on the map. Debug this specifically, don't just re-check the obvious:

- Confirm the map layer/source is actually being **updated**, not just created once on mount. If the route source is set with `setData()` (MapLibre/Mapbox) or a state prop (Leaflet `<Polyline>`), verify it re-runs every time `waypoints` or the computed route changes — check `useEffect` dependency arrays.
- Check **coordinate order**. This is the single most common cause of "nothing draws, no error thrown": GeoJSON and most map libraries expect `[lon, lat]`, but app state and the API here use `{lat, lon}`. Verify every place a waypoint or route point gets converted into map-library coordinates.
- Confirm the route source/layer is added to the map **after** the map's `load` event fires, not before — adding a source too early silently no-ops in some libraries.
- Add a temporary console log of the final coordinate array right before it's handed to the map layer, and manually sanity-check the numbers for the Dhamra→Chennai case (20.82, 86.97 → 13.10, 80.30) before removing the log.

## 2. Bug: left sidebar doesn't scroll

The Route/Result section gets cut off with no way to scroll to it (visible in the current screenshot — "Estimated arrival" is clipped at the bottom).

- The sidebar container almost certainly has `overflow` unset or `hidden` while its content exceeds the viewport height. Fix: sidebar container should be `height: 100vh` (or `100%` of a flex parent) with `overflow-y: auto`, and nested flex children need `min-height: 0` — a common trap where a flex child won't shrink/scroll because the default `min-height: auto` forces it to stay content-sized.
- Test by adding a 3rd and 4th waypoint so the list + results genuinely overflow, and confirm the whole sidebar scrolls while the map stays fixed.

## 3. Feature: render the route as a straight (geodesic) line for now

Don't build land-avoidance yet. For this stage, the "route" is just the great-circle path between consecutive waypoints, drawn as a smooth curve:

- For each leg (consecutive waypoint pair), compute points along the **geodesic** (great-circle on WGS84, not a flat straight line and not a rhumb line) — sample every ~20–50nm so it renders as a smooth curve on the map projection rather than a jagged 2-point line.
- Concatenate all legs in order into one route for multi-waypoint routes.
- Recompute and redraw on every waypoint add/remove/reorder/edit and on speed/departure changes (speed/time only affect duration + ETA, not the path itself).
- Distance shown in the results panel must be computed from the same geodesic math as the line — no separate/approximate distance formula, or the two will drift apart on long high-latitude routes.
- Do not add land avoidance, chokepoint detection, or ECA-distance logic yet — leave those as explicit no-ops/TODOs (e.g. `distanceInEcaNm = 0`, `crossings = []`) so the next stage can fill them in without restructuring this one. Keep the geodesic-path function isolated (pure function: waypoints in, polyline + distance out) so it's a clean swap-in later per the staged plan in the original spec.

## Acceptance criteria for this stage

- [ ] Adding 2+ waypoints immediately draws a visible curved line connecting them in order; editing/reordering/removing a waypoint updates the line live.
- [ ] The distance number in the results panel matches the rendered line's actual geodesic length (spot-check Dhamra→Chennai against a known value, ~600nm).
- [ ] Sidebar scrolls independently of the map when its content overflows; map never scrolls with it.
- [ ] Route line renders correctly for these three test cases:
  1. **Short coastal**: Dhamra → Chennai (sanity check, already in the UI).
  2. **Polar/long-distance**: an Indian port → an Antarctic coordinate (e.g. Bharati Research Station, ~69.4S 76.2E) — confirm the geodesic curve bends correctly at high southern latitude and doesn't just draw a straight line on the flat map projection that looks wrong.
  3. **Antimeridian crossing**: a route where the great circle crosses the 180° line (e.g. India → US West Coast) — confirm the line doesn't wrap incorrectly across the whole map.

Once these three are confirmed working, we'll move to land avoidance (Stage B in the original spec) as its own follow-up prompt.