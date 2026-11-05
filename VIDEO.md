# Demo video — the planner

A 90.5-second detailed tour of the planner panel: the vessel picker and its
eight types, draft and ice class, port search, departure, speed, all four
optimisation objectives, the full results readout, per-leg breakdown and
crossings, voyage playback, and adding a call mid-route.

The tour lives inside the app. Zooms are real `map.flyTo` camera moves, and the
controls are driven the way a user drives them — the port autocomplete is
really typed into, character by character, and the suggestion is really
clicked. There is no motion blur.

---

## 1. The planner, control by control

### Vessel & Specs

Picking a vessel **auto-fills its draft and service speed**. Choosing
Icebreakers also promotes the ice class from Standard.

| Vessel | Speed | Draft |
|---|---|---|
| 📦 Cargo Ships | 15 kn | 10.5 m |
| 🛢️ Tankers | 14 kn | 14.5 m |
| 🛳️ Passenger Ships | 20 kn | 7.5 m |
| ⚓ Service Ships | 12 kn | 5.0 m |
| 🎣 Fishing | 10 kn | 3.5 m |
| 🧊 Icebreakers | 13 kn | 9.0 m |
| 🔬 Non-commercial | 13 kn | 6.0 m |
| 🚤 All Others | 12 kn | 6.0 m |

- **Draft** — 1.0 to 28.0 m, in 0.5 m steps. Feeds shallow-water avoidance.
- **Ice Class** — Standard (No Ice Class) · Polar Class (PC1–PC7) · Heavy
  Icebreaker. Note these are the *only* three valid values; they are not the
  same vocabulary as the POLARIS layer's PC1–PC7 selector.

### Route points

- Type to search the **NGA World Port Index**; the dropdown shows flag, name,
  country code and coordinates.
- Or paste a raw `lat,lon` and pick **Use coordinate** — open-ocean waypoints
  need no port.
- **Add new point** appends; the grip handle reorders by drag; the × removes.
  Minimum two points.

### Passage settings

- **Speed** — slider, 1 to 24 kn. Moves ETA and fuel burn together.
- **Departure (UTC)** — datetime, plus a **now** button. Every downstream
  timestamp, the weather sampling and the berg positions are anchored to it.
- **Optimize for** — four objectives:

| Objective | What it does |
|---|---|
| 📏 Shortest distance | Pure geodesic cost |
| ⚡ Fastest | Weighted by weather and currents |
| ⛽ Most fuel efficient | Fuel-curve costing |
| 🛡️ Maximum safety | Penalises extreme weather |

### What comes back

| Row | Notes |
|---|---|
| Route stops | Numbered origin → destination |
| Distance | Total geodesic, in nm |
| Distance in ECA | Emission control areas |
| Distance in Sea Ice | With max concentration % |
| POLARIS ice risk | **Only shown when `maxPolarisRisk > 0`** — currently never |
| Ice costing source | Says outright when it used synthetic data |
| Estimated Fuel Burn | MT, with peak ice penalty vs open water |
| Safety Score | /100, labelled Optimal / Moderate / High Risk |
| Current Assistance | Net knots gained or lost to currents |
| Duration + Arrival (UTC) | |
| Per leg | Distance and time for each leg |
| Crossings | Chokepoint chips |
| Closest approaches | Nearest tracked iceberg and its distance |

**Voyage playback** — the play button steps the clock 30 simulated minutes
every 150 ms, moving the ship marker, the tracked bergs and the conditions HUD
together. The slider scrubs the same clock by hand, with a % readout.

### Honesty notes for this cut

- The results panel prints *"Ice costing used synthetic (model unavailable) —
  not the trained forecast"*. That line will be on camera during the results
  scene. It is the app being honest, and it is correct: `seaice_forecast` is
  not installed.
- The **POLARIS ice risk row never appears**, because it is gated on
  `maxPolarisRisk > 0` and the index has no model behind it.
- Iceberg drift **is** a live trained model (two-stage GBM, 3.96 km RMS @ 24h),
  so the closest-approach figures are real.

---

## 2. Run the tour

| How | What it does |
|---|---|
| Press **T** | Starts immediately. **T** again or **Esc** stops. |
| Click **▶ Play demo tour** | Same. Hides itself while playing. |
| Open `?tour=1` | Auto-starts 2.5s after load — record this one. |

```
http://localhost:5173/?tour=1
```

`?tour=1&delay=5000` for a longer lead-in. The tour resets the app on every
start, so takes are repeatable — the same 90.5 seconds each time.

## 3. Record

1. Size the browser to 16:9, go fullscreen (**⌃⌘F**).
2. **⌘⇧5** → *Options* → **Show Mouse Pointer off**.
3. Start recording, then load `?tour=1`.
4. It begins 2.5s after load and ends itself at 90.5s.
5. Note the seconds before the first title card — that is your `--start` trim.

## 4. Cue sheet

Regenerate after changing any `dur`: `npm --prefix frontend run tour:cues`

| In | Out | Scene | On screen |
|---|---|---|---|
| 0:00.0 | 0:05.0 | cold-open | **The Planner** — *Vessel, waypoints, speed, objective* |
| 0:05.0 | 0:13.0 | vessel | Vessel & specs · Eight types, each sets draft and speed |
| 0:13.0 | 0:18.5 | specs | Draft & ice class · 1 to 28 m |
| 0:18.5 | 0:26.0 | origin | Route points · Search the World Port Index |
| 0:26.0 | 0:34.0 | destination | Destination · Two points solves the track |
| 0:34.0 | 0:42.0 | results | What comes back · Distance, ECA, ice, fuel, safety |
| 0:42.0 | 0:47.5 | departure | Departure (UTC) · Anchors every timestamp |
| 0:47.5 | 0:54.0 | speed | Speed · 1 to 24 knots |
| 0:54.0 | 1:02.5 | objective | Optimise for · Four objectives |
| 1:02.5 | 1:09.0 | legs | Per leg · Broken out, with crossings |
| 1:09.0 | 1:17.0 | playback | Voyage playback · Scrub or play |
| 1:17.0 | 1:25.5 | addpoint | Add a point · The track re-plans |
| 1:25.5 | 1:30.5 | outro | **The Planner** — *Set the ship. Set the stops.* |

## 5. Voiceover script

About 190 words. Leave air between lines rather than racing the picture.

> **0:00 — cold open**
> This is the planner. Set the ship, set the stops, and read the passage.
>
> **0:05 — vessel**
> Eight vessel types. Pick one and it brings its own service speed and draft —
> a tanker sits fourteen and a half metres deep, an icebreaker rather less.
>
> **0:13 — specs**
> Draft runs from one metre to twenty-eight. And the ice class is not
> decoration — the router costs it.
>
> **0:18 — origin**
> Points come from the NGA World Port Index. Type a name — or paste a raw
> coordinate for open ocean.
>
> **0:26 — destination**
> Two points is all the engine needs.
>
> **0:34 — results**
> And this is what comes back. Distance, how much of it inside emission control
> areas, how much through sea ice, fuel burn, a safety score, duration and
> arrival.
>
> **0:42 — departure**
> Departure is in UTC, and everything downstream is anchored to it.
>
> **0:47 — speed**
> Speed moves the ETA and the fuel together.
>
> **0:54 — objective**
> Then choose what you are optimising for. Shortest. Fastest. Most fuel
> efficient. Or maximum safety.
>
> **1:02 — legs**
> It breaks out per leg, with every chokepoint the track crosses.
>
> **1:09 — playback**
> Press play and sail it — the ship, the bergs and the conditions all move
> on the same clock.
>
> **1:17 — add a point**
> Drop a call en route, and the whole track re-plans around it.
>
> **1:25 — outro**
> The planner. Set the ship. Set the stops. Read the passage.

## 6. Mix and encode

```bash
video/postproduce.sh \
  --raw   ~/Desktop/take1.mov \
  --start 3.2 \
  --vo    ~/Desktop/vo.m4a \
  --music ~/Desktop/bed.mp3
```

Trims to the first frame, normalises to 1920×1080 at 60fps, fades head and
tail, mixes the voiceover over a side-chain-ducked music bed. Every audio input
is optional. Output: `video/ship-route-planner.mp4`

---

## Editing the tour

| File | What it holds |
|---|---|
| `frontend/src/tour/storyboard.js` | **The planner cut** — scenes, timings, captions, camera |
| `frontend/src/tour/storyboard.layers.js` | Archived map-layers cut |
| `frontend/src/tour/storyboard.antarctic.js` | Archived Antarctic cut |
| `frontend/src/tour/engine.js` | Playback — strict wall-clock so the voiceover cannot drift |
| `frontend/src/tour/TourOverlay.jsx` | Title cards, kinetic captions, stat cards, spotlights |
| `frontend/src/tour/mapfx.js` | Route draw-on, run against the real map |
| `frontend/src/tour/tour.css` | The animations |
| `frontend/src/tour/mapBus.js` | Hands the MapLibre instance to the tour |

Point `TourOverlay.jsx`'s storyboard import at an archived file to play that
cut instead.

### A note on driving React inputs

The port autocomplete and the vessel menu are local component state with no
store API, so the tour drives the DOM directly. Assigning `input.value` is
ignored by React — it tracks the node's previous value — so `setNativeValue`
goes through the prototype's native setter and then dispatches the event. The
suggestion list commits on `mousedown`, not `click`, which is why
`pickSuggestion` dispatches that specific event.

`tour:cues` fails loudly if a scene's scripted beats no longer fit its screen
time.
