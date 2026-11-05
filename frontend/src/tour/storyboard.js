/**
 * The demo storyboard: 87 seconds, thirteen scenes — a detailed tour of the
 * planner panel.
 *
 * Covers the vessel picker and its eight types, draft and ice class, port
 * search with autocomplete, departure, speed, all four optimisation
 * objectives, the full results readout, per-leg breakdown and crossings,
 * voyage playback, and adding a waypoint mid-route.
 *
 * REAL INTERACTIONS — the port autocomplete and the vessel menu are local
 * component state with no store API, so those beats drive the actual DOM the
 * way a user would: typing into the input, clicking the suggestion. Everything
 * the store owns is set through the store, which is deterministic and shows up
 * in the same controls.
 *
 * PACING NOTE — every parameter change re-runs the routing engine, and that
 * takes 3.5s for this leg (7.7s for `fuel`, which is why the objective scene
 * skips it). So the vessel and spec beats come *before* any waypoints exist,
 * where they cost nothing, and each later scene mutates exactly one thing,
 * fired at the top of the scene so the result lands before the scene ends.
 *
 * `dur` is the scene's exact screen time. Re-run `npm run tour:cues` after
 * editing.
 */

// MapLibre takes [lon, lat].
const NORTH_SEA = [4.2, 52.4]
const MED = [20, 34]
const SUEZ = [32.55, 29.6]
const ARABIAN_SEA = [62, 14]
const WORLD = [40, 20]

/* ------------------------------------------------------------------ DOM ---
 * React tracks input values on the node, so assigning `.value` directly is
 * ignored. Going through the native setter and then dispatching the event is
 * what makes React see a real keystroke.
 */
function setNativeValue(el, value) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

/** Types text a character at a time, so the autocomplete visibly narrows. */
async function typeInto(selector, text, sleep, perChar = 90) {
  const el = document.querySelector(selector)
  if (!el) return
  el.focus()
  for (let i = 1; i <= text.length; i++) {
    setNativeValue(el, text.slice(0, i))
    await sleep(perChar)
  }
}

/** The suggestion list commits on mousedown, not click. */
function pickSuggestion(rowSelector, index = 0) {
  const row = document.querySelector(rowSelector)
  const item = row?.querySelectorAll('.autocomplete .ac-item')[index]
  item?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
}

export const storyboard = [
  {
    id: 'cold-open',
    kind: 'title',
    dur: 5000,
    letterbox: true,
    title: 'The Planner',
    subtitle: 'Vessel, waypoints, speed, objective — and what comes back',
    async run(ctx) {
      ctx.chrome(false)
      ctx.clearSpotlight()
      ctx.jump({ center: [10, 34], zoom: 1.6, pitch: 0, bearing: 0 })
      ctx.fly({ center: WORLD, zoom: 2.4, duration: 5000 })
    },
  },

  {
    id: 'vessel',
    kicker: 'Vessel & specs',
    caption: 'Eight vessel types — each sets its own draft and service speed',
    dur: 8000,
    async run(ctx) {
      ctx.chrome(true)
      await ctx.sleep(900)
      ctx.spotlight({ selector: '.vessel-section', label: 'Vessel & Specs' })
      await ctx.sleep(600)
      // No waypoints yet, so these selections cost nothing to re-route.
      document.querySelector('.vessel-select-trigger')?.click()
      await ctx.sleep(2200)
      // Tankers: 14.5 m draft, 14 kn — both auto-filled by the selection.
      document.querySelectorAll('.vessel-option')[1]?.click()
      await ctx.sleep(1600)
      document.querySelector('.vessel-select-trigger')?.click()
      await ctx.sleep(1400)
      document.querySelectorAll('.vessel-option')[5]?.click()
    },
  },

  {
    id: 'specs',
    kicker: 'Draft & ice class',
    caption: 'Draft from 1 to 28 m — and an ice class the router actually costs',
    dur: 5500,
    async run(ctx) {
      // Picking Icebreakers already promoted the ice class; make it explicit.
      ctx.planner.setDraftMeters(9.0)
      await ctx.sleep(1400)
      ctx.planner.setIceClass('icebreaker')
      await ctx.sleep(1200)
      ctx.spotlight({ selector: '.vessel-specs-row', label: 'Draft · Ice class' })
    },
  },

  {
    id: 'origin',
    kicker: 'Route points',
    caption: 'Search the NGA World Port Index — or paste a raw coordinate',
    dur: 7500,
    async run(ctx) {
      ctx.clearSpotlight()
      ctx.fly({ center: NORTH_SEA, zoom: 5.0, pitch: 0, duration: 3000 })
      await ctx.sleep(900)
      ctx.spotlight({ selector: '.waypoint-list', label: 'Origin' })
      await ctx.sleep(500)
      await typeInto('.waypoint-list > div:nth-child(1) .wp-input', 'Rotterdam', ctx.sleep)
      await ctx.sleep(1100)
      pickSuggestion('.waypoint-list > div:nth-child(1)')
    },
  },

  {
    id: 'destination',
    kicker: 'Destination',
    caption: 'Two points is all the engine needs to solve the track',
    dur: 8000,
    async run(ctx) {
      await ctx.sleep(400)
      await typeInto('.waypoint-list > div:nth-child(2) .wp-input', 'Keppel', ctx.sleep)
      await ctx.sleep(1000)
      pickSuggestion('.waypoint-list > div:nth-child(2)')
      ctx.clearSpotlight()
      // ~3.5s of routing, then MapView frames the whole track itself.
      await ctx.sleep(4200)
      ctx.drawRoute(1500)
    },
  },

  {
    id: 'results',
    kicker: 'What comes back',
    caption: 'Distance, ECA, sea ice, fuel, safety, duration, arrival',
    dur: 8000,
    stats: true,
    async run(ctx) {
      await ctx.sleep(600)
      ctx.spotlight({ selector: '.results', label: 'Route readout' })
    },
  },

  {
    id: 'departure',
    kicker: 'Departure (UTC)',
    caption: 'Every timestamp downstream is anchored to this one',
    dur: 5500,
    async run(ctx) {
      ctx.clearSpotlight()
      ctx.fly({ center: MED, zoom: 3.4, pitch: 0, duration: 2600 })
      await ctx.sleep(700)
      ctx.spotlight({ selector: '.departure-row', label: 'Departure · now' })
      await ctx.sleep(800)
      document.querySelector('.now-btn')?.click()
    },
  },

  {
    id: 'speed',
    kicker: 'Speed',
    caption: '1 to 24 knots — it moves the ETA and the fuel burn together',
    dur: 6500,
    async run(ctx) {
      ctx.spotlight({ selector: '.speed-row', label: 'Service speed' })
      // One change only: each re-runs the engine for ~3.5s.
      ctx.planner.setSpeedKnots(20)
      await ctx.sleep(4600)
      ctx.clearSpotlight()
    },
  },

  {
    id: 'objective',
    kicker: 'Optimise for',
    caption: 'Shortest distance · Fastest · Most fuel efficient · Maximum safety',
    dur: 8500,
    async run(ctx) {
      ctx.spotlight({ selector: '.opt-select', label: 'Objective' })
      ctx.planner.setOptimizeFor('time')
      await ctx.sleep(4200)
      ctx.planner.setOptimizeFor('safety')
      await ctx.sleep(3600)
    },
  },

  {
    id: 'legs',
    kicker: 'Per leg',
    caption: 'Each leg broken out, with every chokepoint the track crosses',
    dur: 6500,
    async run(ctx) {
      ctx.fly({ center: SUEZ, zoom: 4.6, pitch: 35, duration: 3000 })
      await ctx.sleep(900)
      ctx.spotlight({ selector: '.res-per-leg', label: 'Legs · crossings' })
    },
  },

  {
    id: 'playback',
    kicker: 'Voyage playback',
    caption: 'Scrub or play the passage — the ship and conditions follow',
    dur: 8000,
    async run(ctx) {
      ctx.clearSpotlight()
      ctx.fly({ center: ARABIAN_SEA, zoom: 3.4, pitch: 20, duration: 2800 })
      await ctx.sleep(700)
      ctx.spotlight({ selector: '.voyage-slider-section', label: 'Play · scrub · %' })
      await ctx.sleep(600)
      ctx.planner.setIsPlaying(true)
      await ctx.sleep(5000)
      ctx.planner.setIsPlaying(false)
    },
  },

  {
    id: 'addpoint',
    kicker: 'Add a point',
    caption: 'Drop a call en route and the whole track is re-planned',
    dur: 8500,
    async run(ctx) {
      ctx.clearSpotlight()
      ctx.fly({ center: [55, 18], zoom: 3.0, pitch: 0, duration: 2800 })
      await ctx.sleep(600)
      // Appended then moved: addWaypoint only ever pushes to the end, and the
      // call has to sit between origin and destination.
      ctx.planner.addWaypoint({ label: 'Salalah', countryCode: 'OM', lat: 16.95, lon: 54.0, isPort: true })
      await ctx.sleep(150)
      ctx.planner.moveWaypoint(2, 1)
      await ctx.sleep(4200)
      ctx.drawRoute(1600)
    },
  },

  {
    id: 'outro',
    kind: 'title',
    dur: 5000,
    letterbox: true,
    title: 'The Planner',
    subtitle: 'Set the ship. Set the stops. Read the passage.',
    async run(ctx) {
      ctx.clearSpotlight()
      ctx.chrome(false)
      ctx.fly({ center: WORLD, zoom: 2.0, pitch: 0, bearing: 0, duration: 4200 })
    },
  },
]

/** The figures the results scene counts up, read live off the route. */
export const STAT_CARDS = [
  { key: 'distance', label: 'Nautical miles', decimals: 0, get: (r) => r.totalDistanceNm },
  { key: 'hours', label: 'Hours at sea', decimals: 0, get: (r) => r.totalDurationHours },
  { key: 'fuel', label: 'Tonnes of fuel', decimals: 0, get: (r) => r.estimatedFuelTons },
  { key: 'safety', label: 'Safety score', decimals: 0, get: (r) => r.safetyScore },
]

/** Resets the app to the state every take must start from. */
export function resetForTour(planner) {
  for (let i = (planner.waypoints || []).length - 1; i >= 2; i--) planner.removeWaypoint(i)
  planner.setWaypoint(0, { label: '', countryCode: '', lat: null, lon: null, isPort: true })
  planner.setWaypoint(1, { label: '', countryCode: '', lat: null, lon: null, isPort: true })
  planner.setVesselType('cargo')
  planner.setDraftMeters(10.5)
  planner.setSpeedKnots(15)
  planner.setIceClass('none')
  planner.setOptimizeFor('distance')
  planner.setIsPlaying(false)
  planner.setBasemap('google-sat')
  planner.setShowChevrons(true)
  planner.setShowEca(true)
  planner.setShowChokepoints(true)
  planner.setShowSeaIce(false)
  planner.setShowWindFlow(false)
  planner.setShowOceanCurrents(false)
  planner.setShowIceRisk(false)
  planner.setShowSeamarks(false)
}
