# Stage 6 prompt — separate the layers, add storm/weather forecasting via Open-Meteo

Paste this to the agent working on the route planner codebase, following Stage 5 (iceberg markers + mock drift + time slider).

---

Two problems to fix, and one feature to add.

## 0. Fix: stop merging everything into one heatmap

The current build has combined icebergs, route, and (implicitly) weather into a single heatmap layer. This is wrong — go back to the separation-of-concerns principle already used elsewhere in this build (geodesic vs A* path, ship-position-over-time as its own pure function, iceberg prediction as its own module): **each of these is an independent map layer with its own data source and its own rendering component**, not one blended visualization.

Required layers, each independently toggleable (add toggles in the Settings tab if not already there):

- **Route line** — the computed path (Stage 3/4).
- **Waypoint markers** — numbered pins (already built).
- **ECA zones** — polygon overlay (Stage 3).
- **Iceberg markers** — triangle icons at their time-interpolated position (Stage 5). This stays point markers, not a heatmap.
- **Storm/weather hazard layer** (new, this stage) — its own overlay, see below. This is the one place a heatmap-style rendering (e.g. a semi-transparent colored overlay for wave height or wind speed intensity) is actually appropriate, but it must be its own layer that can be hidden without hiding icebergs or the route.

No layer's rendering code should read another layer's data. If the agent finds itself passing iceberg data into the same component that draws weather, that's the bug to fix.

## 1. Storm/weather data via Open-Meteo

Two endpoints, both free/no-API-key for non-commercial use:

- **Weather Forecast API** — `https://api.open-meteo.com/v1/forecast` — for wind and storm signals. Relevant hourly variables: `wind_speed_10m`, `wind_gusts_10m`, `weather_code`, `precipitation`, `cape` (convective energy, useful as a severe-weather indicator). Forecast horizon: up to **16 days** (`forecast_days` param, max 16).
- **Marine Weather API** — `https://marine-api.open-meteo.com/v1/marine` — for sea state. Relevant hourly variables: `wave_height`, `wave_period`, `swell_wave_height`. Forecast horizon: up to **8 days only** (`forecast_days` param, max 8) — noticeably shorter than the general weather forecast.

Both accept multiple coordinates in a single request as comma-separated `latitude=`/`longitude=` lists — batch all sample points for a call rather than firing one request per point. Both accept `start_date`/`end_date` or `start_hour`/`end_hour` to scope the request window. Use `wind_speed_unit=kn` on the forecast call to keep units consistent with the rest of this app (everything else is already in knots/nm).

### Constraint to design around: forecast horizon is anchored to *today*, not to the ship's departure date

This is a real limitation of any weather forecast — Open-Meteo (like all forecast APIs) can only predict a couple weeks out from the current real-world date, regardless of when the user's selected departure time is. Concretely:

- If a voyage is short (a few days) and departs soon, most or all of it will have real forecast data.
- If a voyage is long (e.g. the India→Antarctica case, ~30+ days) or the departure date is set far in the future, **large parts of the route will fall outside both the 16-day weather horizon and the 8-day marine horizon** — this is expected, not an integration bug.
- For each point/time along the route, check whether `departureTime + elapsedTime` falls within `[today, today + 16 days]` (weather) / `[today, today + 8 days]` (marine) before querying.

### Fallback beyond the forecast horizon: reuse the existing modeled-prediction pattern

Points outside the real-forecast window should **not** just show "no data" — fall back to a modeled estimate, using the same architectural pattern already established for icebergs in Stage 5 (`predict_position` / `generate_trajectory`: an isolated, swappable module that produces a best-guess when no live/real data exists). Build the equivalent here:

```python
def predict_weather_fallback(lat: float, lon: float, target_time: datetime) -> dict:
    """Modeled estimate for a point/time beyond the real forecast horizon.
    Returns the same shape as a real forecast sample (windSpeedKn, waveHeightM,
    hazardLevel, etc.) so callers don't need to branch on data source internally."""
    ...
```

For now this can be as simple as seasonal/climatological averages for that latitude band (e.g. rougher seas and higher wind climatology in the Southern Ocean at higher latitudes, calmer in equatorial routes) — it doesn't need to be sophisticated, it needs to (a) return a plausible number instead of nothing, and (b) be clearly swappable for a real climatology dataset or ML model later without changing its call signature, exactly like the iceberg module.

**Every sample must carry which source produced it** so the UI can distinguish real forecast from modeled estimate — this is the one thing that must never be hidden from the user, since the two have very different reliability:

```
dataSource: "forecast" | "modeled_estimate"
```

Never silently blend the two into a single "just a number" — a modeled estimate 25 days out and a live forecast for tomorrow are not the same kind of information, and the UI/results panel must say which one it's showing.

### Sampling strategy

Reuse the existing route polyline and the `getShipPositionAtTime` function from Stage 5 — don't build a second way to compute where the ship is at a given time.

- Pick a sampling interval along the route in time, not distance (e.g. every 3–6 hours of transit) — this naturally gives more samples through slow/coastal legs and fewer through fast open-ocean stretches.
- For each sample point that falls within the forecast horizon, that's one `{lat, lon, timestamp}` to query.
- Batch all in-horizon sample points from both endpoints (weather + marine) into as few requests as possible using the multi-coordinate support — do not loop one request per point per variable.
- Cache responses per route computation; don't re-fetch on every slider drag (same principle as Stage 5's iceberg trajectory fetching — fetch once, interpolate/read locally on the client after that).

### Hazard classification

Derive a simple per-sample-point hazard flag/score from the returned data so the UI has something to color/highlight, e.g.:

- `weather_code` in `{95, 96, 99}` → thunderstorm present.
- `wind_speed_10m` or `wind_gusts_10m` above a threshold (e.g. gale-force, ~34 kn sustained) → high wind.
- `wave_height` above a threshold (e.g. 4m = rough, 6m+ = very rough) → rough seas.

Combine into a simple severity tier (e.g. `none` / `moderate` / `severe`) per sample point — exact thresholds can be tuned later, the point of this stage is wiring the pipeline, not calibrating meteorological thresholds precisely.

## 2. API surface

```
GET /api/route-weather?routeId=&departureTime=
  returns: {
    samples: [
      { lat, lon, timestamp, dataSource: "forecast" | "modeled_estimate",
        windSpeedKn, windGustsKn, waveHeightM, weatherCode?, hazardLevel }
    ]
  }
```

Every sample always has weather values populated — either from the real Open-Meteo call (`dataSource: "forecast"`) or from `predict_weather_fallback` (`dataSource: "modeled_estimate"`). No sample should ever be null/empty; the frontend's job is to style the two sources differently, not to handle a missing-data case.

## 3. Frontend

- New "Storms" toggle in Settings, independent of the iceberg and ECA toggles.
- Render sample points as a hazard overlay (color-coded by severity — this is the one heatmap-style layer, per §0).
- Visually distinguish `forecast` from `modeled_estimate` samples — e.g. solid color for real forecast, a hatched/dashed/lower-opacity style for modeled estimate — so the user can tell at a glance which parts of the route are backed by real data versus a best-guess model. Never make them look identical.

### Timeline slider: show the active layer's data at the current time, live

The time slider (built in Stage 5 for the ship + iceberg positions) needs to extend to whichever layer is currently toggled on, not just icebergs:

- As the slider moves, show a small live readout of the ship's *current* conditions at that point in time, sourced from whichever layer(s) are active:
  - **Icebergs layer on** → nearest iceberg + distance (existing Stage 5 behavior).
  - **Storms layer on** → the weather/sea state at the ship's interpolated position for that exact slider timestamp (wind speed, wave height, hazard level, and whether it's `forecast` or `modeled_estimate`) — interpolate between the two nearest sample points along the route for that timestamp, same interpolation approach already used for ship position and iceberg trajectories.
  - **Both on** → show both readouts together.
  - **Neither on** → no readout, just the ship marker moving.
- This readout should update live and smoothly as the slider is dragged — no extra API calls per tick, since all samples for the route were already fetched once when the route was computed (per the caching note above).
- Results panel: keep the existing summary-line behavior (e.g. "Rough seas (5.2 m waves) expected near 14°N 82°E, day 3 of voyage") but tag each summary with its `dataSource` so a modeled-estimate warning reads differently from a confirmed-forecast warning, e.g. append "(modeled estimate — beyond forecast range)" where relevant.

## Acceptance criteria

- [ ] Icebergs, storms, ECA zones, and the route render as visually and architecturally separate layers — toggling one off in Settings does not affect any other.
- [ ] Weather/marine data is fetched from the real Open-Meteo endpoints for in-horizon route points, batched (not one request per point).
- [ ] Route points beyond the 16-day (weather) / 8-day (marine) horizon fall back to `predict_weather_fallback` and are visually distinguished as `modeled_estimate`, never presented identically to a real forecast.
- [ ] The fallback module has the same call-signature-isolation as the iceberg prediction module — confirm it could be swapped for a real climatology dataset without touching any caller.
- [ ] Dragging the time slider shows a live readout matching whichever layer(s) are toggled on (icebergs, storms, or both) — no extra network calls while dragging.
- [ ] Test on a short domestic route (e.g. Mumbai → Chennai, departing soon) — should be fully `forecast`-sourced, no fallback needed.
- [ ] Test on the India → Antarctica route — should show `forecast` for roughly the first one to two weeks and `modeled_estimate` for the remainder, with the slider readout correctly reporting which source is active as it crosses that boundary.
- [ ] No avoidance/rerouting logic yet — this stage is data + visualization only, same as icebergs in Stage 5. A future stage can feed hazard data (from either source) into the routing algorithm as a soft cost (prefer routes/times with lower storm severity) once this pipeline is confirmed working.
