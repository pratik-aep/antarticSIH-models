/**
 * ARCHIVED — the Antarctic cut, 52.5 seconds, nine scenes.
 *
 * Not wired up. `TourOverlay.jsx` imports from `storyboard.js`; point that
 * import here to play this cut instead of the map-layers one.
 *
 * Every scene drives the real application state — real ports, the real A*
 * search, the real trained drift model. Nothing here is mocked.
 *
 * WHY 2018-12-20 — the iceberg drift model was trained on National Ice Center
 * fixes ending 2018-12-21. Departing "now" would ask it to predict seven years
 * past its last observation, so the tour sets the clock to the model's own
 * window and the berg tracks on screen are genuine forward predictions.
 *
 * PACING NOTE — the A* search takes ~2.4s for a Southern Ocean leg, so the
 * expensive work is pipelined: waypoints land behind the opening title card,
 * and the re-plan is fired at the top of the scene that shows its result.
 * Asking for a route and cutting to it immediately just puts a spinner on
 * camera.
 *
 * `dur` is the scene's exact screen time. Re-run `npm run tour:cues` after
 * editing.
 */

// Real entries from the NGA World Port Index, as returned by /api/ports.
const USHUAIA = { label: 'Ushuaia', countryCode: 'AR', lat: -54.8167, lon: -68.3, isPort: true }
const CAPE_TOWN = { label: 'Cape Town', countryCode: 'ZA', lat: -33.9167, lon: 18.4167, isPort: true }

// Open water in the Weddell Sea, in among the tracked bergs. Not a port —
// this is the waypoint the A* scene drops to force a re-plan through the ice.
const WEDDELL = { label: 'Weddell Sea', countryCode: '', lat: -70.0, lon: -40.0, isPort: false }

// The drift model's own window. Outside it there is nothing to predict from.
const DEPARTURE = '2018-12-20T00:00'

// MapLibre takes [lon, lat].
const SOUTHERN_OCEAN = [-24, -52]
const DRAKE_PASSAGE = [-62, -58]
const WEDDELL_VIEW = [-40, -67]
const ANTARCTIC_WIDE = [-30, -60]

export const storyboard = [
  {
    id: 'cold-open',
    kind: 'title',
    dur: 5500,
    letterbox: true,
    title: 'Ship Route Planner',
    subtitle: 'Antarctic routing, driven by trained models',
    async run(ctx) {
      ctx.chrome(false)
      ctx.clearSpotlight()
      ctx.jump({ center: [-30, -20], zoom: 1.6, pitch: 0, bearing: 0 })
      ctx.fly({ center: SOUTHERN_OCEAN, zoom: 2.6, duration: 5500 })

      // Clock and both ports land behind the title card. The search needs
      // ~2.4s, so the reveal cuts to a solved track, not a spinner.
      await ctx.sleep(1600)
      ctx.planner.setDepartureTimeUTC(DEPARTURE)
      ctx.planner.setSpeedKnots(14)
      ctx.planner.setIceClass('pc4')
      ctx.planner.setWaypoint(0, USHUAIA)
      ctx.planner.setWaypoint(1, CAPE_TOWN)
    },
  },

  {
    id: 'reveal',
    kicker: 'Ushuaia → Cape Town',
    caption: '3,700 nautical miles of Southern Ocean',
    dur: 5000,
    async run(ctx) {
      ctx.chrome(true)
      // MapView fits the route bounds itself the moment the route resolves.
      await ctx.sleep(1400)
      ctx.drawRoute(1600)
    },
  },

  {
    id: 'models',
    kicker: 'Not a simulation',
    caption: 'Iceberg drift is a trained model — 3.96 km RMS at 24 hours',
    dur: 6000,
    async run(ctx) {
      // Open the status dropdown so the live model row is on camera. This is
      // the app's own disclosure panel, not a caption claiming it.
      await ctx.sleep(700)
      document.querySelector('.model-status-head')?.click()
      await ctx.sleep(500)
      ctx.spotlight({ selector: '.model-status', label: '14,913 berg fixes' })
      await ctx.sleep(3800)
      document.querySelector('.model-status-head')?.click()
      ctx.clearSpotlight()
    },
  },

  {
    id: 'icesheets',
    kicker: 'The ice edge',
    caption: 'Sea-ice concentration, sampled along the whole track',
    dur: 5000,
    async run(ctx) {
      ctx.planner.setShowSeaIce(true)
      ctx.planner.setShowOceanCurrents(true)
      ctx.fly({ center: WEDDELL_VIEW, zoom: 3.4, pitch: 0, duration: 3000 })
      await ctx.sleep(3400)
      ctx.spotlight({ selector: '.layer-list', label: 'Sea ice' })
    },
  },

  {
    id: 'icebergs',
    kicker: 'Thirteen tracked bergs',
    caption: 'A23A — the largest iceberg on Earth — B16, D21B, B09I',
    dur: 6000,
    async run(ctx) {
      ctx.clearSpotlight()
      ctx.fly({ center: [-42, -68], zoom: 4.0, pitch: 25, duration: 3000 })
    },
  },

  {
    id: 'drift',
    kicker: 'Predicted, not interpolated',
    caption: 'Every position stepped forward by the two-stage GBM',
    dur: 6500,
    async run(ctx) {
      ctx.spotlight({ selector: '.play-btn', label: 'Voyage playback' })
      await ctx.sleep(800)
      ctx.planner.setIsPlaying(true)
      await ctx.sleep(4400)
      ctx.clearSpotlight()
      ctx.planner.setIsPlaying(false)
    },
  },

  {
    id: 'astar',
    kicker: 'A* re-solves',
    caption: 'Drop a waypoint in the ice and the whole track is re-planned',
    dur: 8000,
    async run(ctx) {
      ctx.fly({ center: ANTARCTIC_WIDE, zoom: 2.9, pitch: 0, duration: 2600 })
      await ctx.sleep(600)
      // Appended then moved into the middle: addWaypoint only ever pushes to
      // the end, and the re-plan has to happen *between* the two ports.
      ctx.planner.addWaypoint(WEDDELL)
      await ctx.sleep(120)
      ctx.planner.moveWaypoint(2, 1)
      await ctx.sleep(3400)
      ctx.drawRoute(1800)
    },
  },

  {
    id: 'cost',
    kicker: 'What the ice costs',
    caption: '1,823 nm through sea ice — and the safety score falls to 68',
    dur: 5500,
    stats: true,
    async run(ctx) {
      await ctx.sleep(500)
      ctx.spotlight({ selector: '.results', label: 'Route readout' })
    },
  },

  {
    id: 'outro',
    kind: 'title',
    dur: 5000,
    letterbox: true,
    title: 'Ship Route Planner',
    subtitle: 'Plan the route. Know the ice.',
    async run(ctx) {
      ctx.clearSpotlight()
      ctx.chrome(false)
      ctx.fly({ center: [-20, -50], zoom: 1.9, pitch: 0, bearing: 0, duration: 4200 })
    },
  },
]

/** The four figures the cost scene counts up, read live off the route. */
export const STAT_CARDS = [
  { key: 'distance', label: 'Nautical miles', decimals: 0, get: (r) => r.totalDistanceNm },
  { key: 'ice', label: 'NM through sea ice', decimals: 0, get: (r) => r.totalDistanceInSeaIceNm },
  { key: 'safety', label: 'Safety score', decimals: 0, get: (r) => r.safetyScore },
  { key: 'bergs', label: 'Tracked icebergs', decimals: 0, get: (_r, p) => (p.icebergs || []).length },
]

/** Resets the app to the state every take must start from. */
export function resetForTour(planner) {
  // The A* scene inserts a third waypoint, so a second take must drop it or
  // the route starts already re-planned.
  for (let i = (planner.waypoints || []).length - 1; i >= 2; i--) planner.removeWaypoint(i)
  planner.setWaypoint(0, { label: '', countryCode: '', lat: null, lon: null, isPort: true })
  planner.setWaypoint(1, { label: '', countryCode: '', lat: null, lon: null, isPort: true })
  planner.setOptimizeFor('distance')
  planner.setIsPlaying(false)
  planner.setShowWindFlow(false)
  planner.setShowChokepoints(false)
  planner.setShowSeaIce(false)
  planner.setShowOceanCurrents(false)
  planner.setShowEca(true)
}
