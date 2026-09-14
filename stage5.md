# Stage 5 prompt — iceberg markers, mock movement prediction, time slider synced to ship position

Paste this to the agent working on the route planner codebase, following Stage 4 (land-avoidance smoothing/fixes).

---

This stage is visualization + mock data only. No real drift physics, no ML, and icebergs should not yet affect routing (no avoidance logic) — that's a future stage. The goal here is: icebergs rendered on the map as triangles, a backend Python component that outputs their position over time (currently a simple predefined/deterministic mock, structured so a real model can be swapped in later), and a time slider that moves the ship and the icebergs together so the user can see where the ship will be relative to each iceberg at any point along the voyage.

## 1. Data model

```
Iceberg {
  id: string
  name?: string              // optional label, e.g. "Berg A"
  sizeCategory?: string       // "growler" | "bergy bit" | "small" | "medium" | "large" — cosmetic for now, matters once avoidance logic exists
  initialPosition: { lat, lon, timestamp }
  trajectory: { lat, lon, timestamp }[]   // precomputed points; frontend interpolates between them for smooth slider motion
}
```

Keep `trajectory` as a list of timestamped points rather than a velocity vector the client has to integrate — push the prediction math to the backend, the frontend only interpolates between two known points for the current slider time.

## 2. Backend: Python mock prediction module

Build this as an isolated module with a swap-in-ready interface, since you said this becomes a real prediction model later:

```python
def predict_position(iceberg_initial: dict, target_time: datetime) -> dict:
    """Given an iceberg's initial state and a target time, return {lat, lon}."""
    ...

def generate_trajectory(iceberg_initial: dict, start_time: datetime, end_time: datetime, step_hours: float) -> list[dict]:
    """Return a list of {lat, lon, timestamp} points from start_time to end_time."""
    ...
```

For now, implement `predict_position` as simple linear drift: give each mock iceberg a fixed heading + speed (e.g. 0.3–0.8 kn, a realistic order of magnitude for iceberg drift) and project forward with basic geodesic math — same distance/bearing utilities the route engine already has, don't write new ones. Seed 2–3 mock icebergs with different headings/speeds so they visibly diverge over the slider's time range, and place at least one so its predicted track passes near the ship's route path (otherwise the feature has nothing interesting to show when you demo it).

Expose this via the existing API layer — if the main backend isn't Python, wrap this module behind a small internal service or a subprocess call from the main API, whichever fits the existing stack better; don't rewrite the main backend's language for this.

```
GET /api/icebergs?startTime=&endTime=&stepHours=
  returns: Iceberg[]   // each with a full trajectory array covering the requested window
```

## 3. Ship-position-over-time function

This is needed regardless of icebergs and should be a standalone pure function, since the slider needs it and later features (currents affecting speed, ETA display) will too:

```
getShipPositionAtTime(routeResult, departureTime, targetTime) -> { lat, lon }
```

Implementation: walk the route's cumulative distance, using `speedKnots` to convert elapsed time into distance traveled, then interpolate the point along the route polyline at that distance. If `targetTime` is before departure or after arrival, clamp to the start/end point.

## 4. Frontend: time slider

- Add a slider (departure time → arrival time, from the already-computed route) that appears once a route has been computed via the existing "predict"/compute action.
- On slider move: call `getShipPositionAtTime` for the ship marker, and interpolate each iceberg's position between its two nearest trajectory points for the same timestamp — both update together, live, as the slider moves. No extra API calls per slider tick; fetch all iceberg trajectories once for the route's time window when the route is computed, then interpolate client-side.
- Render icebergs as small triangle markers (matching the "triangles depicting icebergs" ask) — distinct from the numbered circular waypoint markers already used for the route.
- Ship marker: a single marker that moves along the route line as the slider moves, distinct from the static numbered waypoint pins.

## 5. Closest-approach readout

Since the point of this feature is eventually collision/route avoidance, add one derived value now even though avoidance logic itself is out of scope: after computing the route and iceberg trajectories, find the timestamp and distance of closest approach between the ship's position-over-time and each iceberg's trajectory (simple discretized search — step through time at a fixed interval, e.g. every 30–60 min, compute distance, take the minimum; no need for continuous optimization at this stage). Surface this in the results panel, e.g.:

> Closest approach to Berg A: 42 nm at 2026-10-03 14:00 UTC

This is the "on which day and time where the ship will be relative to iceberg" part of the ask — it's a summary stat, not a real-time collision check.

## Acceptance criteria

- [ ] 2–3 mock icebergs render as triangle markers on the map after a route is computed.
- [ ] Dragging the time slider moves both the ship marker and all iceberg markers smoothly and in sync — no jump/lag between them.
- [ ] Iceberg trajectory data comes from the isolated Python `predict_position`/`generate_trajectory` module, not hardcoded directly in the frontend or API handler — confirm the module could be swapped for a real model later by only changing its internals, not its call signature.
- [ ] Results panel shows a closest-approach day/time + distance for at least one iceberg whose mock trajectory was deliberately seeded to pass near the route.
- [ ] Test on a polar-ish route (e.g. an India → Antarctica-adjacent leg) since that's the realistic use case for icebergs, not just a coastal India route.

## Explicitly out of scope for this stage

- No real oceanographic/physical drift model — mock linear drift only.
- No route avoidance around icebergs — the ship's path is unaffected by iceberg positions this stage, this is display-only.
- No live/real iceberg data feed (e.g. from IIP or satellite tracking) — that's a real-data integration stage, separate from the prediction model itself.