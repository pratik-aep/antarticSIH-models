# Stage 4 prompt — fix "no navigable route" failures and smooth the path output

Paste this to the agent working on the route planner codebase, following up on Stage 3's land-avoidance A* implementation.

---

Stage 3's A* is correctly finding topology around land (verified: Mumbai→Chennai clears the Indian coastline instead of cutting across it, and Laem Chabang→Toba correctly detours through the Malacca/Singapore Strait rather than a straight line through Malaysia). Two problems remain:

## 1. Bug: "no navigable water route found (enclosed sea or blocked coast)" on valid routes

This is happening on real, sailable routes, so it's a grid-resolution artifact, not a logic bug. Root-cause it against these specific failure modes, don't just widen a timeout or catch-and-hide the error:

- **Narrow chokepoints disappearing at grid resolution.** At a coarse grid (~0.5°), features like the Palk Strait (India/Sri Lanka), the Bosphorus, the Strait of Hormuz, or the Suez Canal can be narrower than a single grid cell — if the sampling marks that cell "land" because land dominates the cell, the only connection between two sea regions vanishes and they become disconnected graph components. A* then correctly reports no path, but the underlying map is wrong. Fix: don't rely on a single uniform grid resolution. Either (a) use a finer grid specifically in a buffer zone around known named chokepoints (the same list built for chokepoint-crossing detection in Stage 3 — reuse it here as "areas requiring higher grid density"), or (b) switch the land/sea classification rule for borderline cells from "majority land = blocked" to "any sea = navigable, unless fully enclosed" so real-but-thin channels don't get erased.
- **Start/end waypoint snapping onto a blocked node.** A port coordinate sits right at the coastline — if it snaps to the nearest grid node and that node happens to be classified as land, A* fails immediately with no path even before searching, because the start node itself isn't in the navigable graph. Fix: when snapping a waypoint to the grid, search outward (spiral/ring search) for the nearest *navigable* node rather than the nearest node period, and log when the snap distance is unexpectedly large (signals a resolution problem in that area).
- **True enclosed seas.** Some water bodies genuinely have no connection at the grid's resolution even when correctly classified (e.g. a lake, or a sea connected only via a canal that isn't represented in the land/sea polygon data at all, like Suez). For these, the fix isn't grid resolution — it's adding known artificial waterways (Suez, Panama, Kiel Canal) as explicit graph edges connecting the two sides, since they won't exist in any coastline dataset.

Test explicitly against: Palk Strait crossing (India ↔ Sri Lanka's north side), a route requiring the Suez Canal (e.g. Mediterranean ↔ Red Sea port pair), and a route requiring the Strait of Hormuz (into/out of the Persian Gulf). All three should currently be suspects for this bug.

## 2. Path smoothing isn't happening (or isn't enough)

The rendered routes are a visible staircase of straight grid-aligned segments (see the Mumbai→Chennai and multi-leg Mumbai→Toba screenshots) instead of a natural curve that just clears the coast. Stage 3 called for Douglas-Peucker simplification followed by smoothing — verify this step actually exists in the pipeline and is running on the A* output before it's returned to the client, not just on the Stage 2 geodesic fallback path.

- Simplify first (Douglas-Peucker, tolerance tuned so it removes grid-stairstep noise without cutting corners into land).
- Then smooth (e.g. Catmull-Rom or Chaikin corner-cutting, applied a couple of passes) so corners become curves.
- **After smoothing, re-validate the path doesn't now cross land** — smoothing a path that hugs a coastline can cut corners onto land if you're not careful; add a cheap check (sample points along the smoothed curve, test against the land polygon) and fall back to a lighter smoothing pass if it fails.
- Confirm distance is recalculated from the final smoothed path, not the pre-smoothed grid path — smoothing changes path length slightly and the results panel must match what's actually drawn.

## Acceptance criteria

- [ ] Palk Strait, Suez Canal, and Strait of Hormuz test routes all return a valid path instead of the enclosed-sea error.
- [ ] A waypoint placed directly on a coastline (e.g. any of the existing port entries) never fails to snap due to landing on a blocked node.
- [ ] Re-render the Mumbai→Chennai and Mumbai→Chennai→Vishakhapatnam→Laem Chabang→Toba cases from the screenshots — paths should now read as smooth curves hugging the coast, not right-angle staircases.
- [ ] Smoothed paths still don't cross land anywhere along their length (spot check the Sri Lanka detour and the Malacca/Singapore detour specifically, since those hug close to a coastline).
- [ ] Displayed distance matches the final smoothed path length, not the pre-smoothing grid path length.

Once these are solid, we're ready for the currents/ice-edge layer (Phase 2 from the original spec) as a separate stage — it only touches timing, not the path, so it shouldn't require touching this stage's code.