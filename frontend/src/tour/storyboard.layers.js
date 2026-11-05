/**
 * ARCHIVED — the map-layers cut, 75.5 seconds, fourteen scenes.
 *
 * Not wired up. `TourOverlay.jsx` imports from `storyboard.js`; point that
 * import here to play this cut instead of the planner one.
 *
 * Covers all seven basemaps and all eight overlay layers, plus the POLARIS
 * polar-class selector, the storm sub-filters, and the All/None quick actions.
 * Each layer gets its own beat over terrain where that layer actually has
 * something to show, rather than being switched on over blank ocean.
 */

// Real entries from the NGA World Port Index, as returned by /api/ports.
const ROTTERDAM = { label: 'Rotterdam', countryCode: 'NL', lat: 51.9, lon: 4.4833, isPort: true }
const SINGAPORE = { label: 'Keppel - (East Singapore)', countryCode: 'SG', lat: 1.2833, lon: 103.85, isPort: true }

// MapLibre takes [lon, lat].
const WORLD = [30, 22]
const NORTH_SEA = [3.6, 52.6]
const ROTTERDAM_APPROACH = [4.05, 51.96]
const SUEZ = [32.55, 29.6]
const ARABIAN_SEA = [62, 14]
const BAY_OF_BENGAL = [85, 10]
const ANTARCTIC = [-40, -66]

/** Clicks one of the layer panel's quick actions by its label. */
function quickAction(label) {
  const btn = [...document.querySelectorAll('.lp-quick-btn')]
    .find((b) => b.textContent.trim() === label)
  btn?.click()
}

export const storyboard = [
  {
    id: 'cold-open',
    kind: 'title',
    dur: 5000,
    letterbox: true,
    title: 'Map Data Selection',
    subtitle: 'Seven basemaps, eight overlays — and what each one draws',
    async run(ctx) {
      ctx.chrome(false)
      ctx.clearSpotlight()
      ctx.jump({ center: [10, 30], zoom: 1.5, pitch: 0, bearing: 0 })
      ctx.fly({ center: WORLD, zoom: 2.5, duration: 5000 })
      await ctx.sleep(1400)
      ctx.planner.setWaypoint(0, ROTTERDAM)
      ctx.planner.setWaypoint(1, SINGAPORE)
    },
  },

  {
    id: 'panel',
    kicker: 'One panel',
    caption: 'Every overlay the map can draw, and a count of what is live',
    dur: 5000,
    async run(ctx) {
      ctx.chrome(true)
      await ctx.sleep(1200)
      ctx.drawRoute(1400)
      quickAction('None')
      ctx.spotlight({ selector: '.layer-list', label: 'Map Data Selection' })
    },
  },

  {
    id: 'basemaps',
    kicker: '7 basemaps',
    caption: 'Satellite, hybrid, streets, OSM, topo, light — two render as a globe',
    dur: 8000,
    async run(ctx) {
      ctx.clearSpotlight()
      ctx.fly({ center: WORLD, zoom: 2.6, pitch: 0, duration: 1800 })
      // Instant: these are preloaded raster layers, not style reloads.
      const order = ['google-hybrid', 'google-streets', 'standard', 'light', 'opentopo', 'apple']
      for (const key of order) {
        await ctx.sleep(1050)
        ctx.planner.setBasemap(key)
      }
      await ctx.sleep(1100)
      ctx.planner.setBasemap('google-sat')
    },
  },

  {
    id: 'chevrons',
    kicker: 'Route chevrons',
    caption: 'Direction of travel, spaced along the track',
    dur: 4500,
    async run(ctx) {
      ctx.planner.setShowChevrons(true)
      ctx.fly({ center: [20, 36], zoom: 3.6, pitch: 0, duration: 2400 })
      await ctx.sleep(2600)
      ctx.spotlight({ selector: '.layer-list', label: 'Route Chevrons' })
    },
  },

  {
    id: 'eca',
    kicker: 'ECA zones',
    caption: 'Emission Control Areas — where sulphur limits bite',
    dur: 5000,
    async run(ctx) {
      ctx.clearSpotlight()
      ctx.planner.setShowEca(true)
      ctx.fly({ center: NORTH_SEA, zoom: 4.4, pitch: 0, duration: 2600 })
    },
  },

  {
    id: 'chokepoints',
    kicker: 'Chokepoints',
    caption: 'Straits, canals and capes — four on this track alone',
    dur: 5000,
    async run(ctx) {
      ctx.planner.setShowChokepoints(true)
      ctx.fly({ center: SUEZ, zoom: 5.2, pitch: 40, duration: 2800 })
    },
  },

  {
    id: 'seamarks',
    kicker: 'Seamarks',
    caption: 'Buoys, lights and depth contours, stacked on any basemap',
    dur: 5500,
    async run(ctx) {
      ctx.planner.setShowSeamarks(true)
      // Seamark tiles only carry detail close in, so the camera goes to the
      // approaches rather than showing an empty overlay at ocean scale.
      ctx.fly({ center: ROTTERDAM_APPROACH, zoom: 10.5, pitch: 0, duration: 3000 })
    },
  },

  {
    id: 'windflow',
    kicker: 'Wind flow',
    caption: 'Animated streamlines drawn across the wind field',
    dur: 6000,
    async run(ctx) {
      ctx.planner.setShowWindFlow(true)
      ctx.fly({ center: ARABIAN_SEA, zoom: 3.4, pitch: 0, duration: 3000 })
      await ctx.sleep(3400)
      ctx.spotlight({ selector: '.layer-list', label: 'Wind Flow' })
    },
  },

  {
    id: 'currents',
    kicker: 'Ocean currents',
    caption: 'Flow vectors — u and v, coloured by speed',
    dur: 5000,
    async run(ctx) {
      ctx.clearSpotlight()
      ctx.planner.setShowOceanCurrents(true)
      ctx.fly({ center: BAY_OF_BENGAL, zoom: 3.6, pitch: 0, duration: 2800 })
    },
  },

  {
    id: 'storms',
    kicker: 'Storms & weather',
    caption: 'Filter the hazard field: wind, waves, storms, rain, severe',
    dur: 5500,
    async run(ctx) {
      ctx.planner.setShowStorms(true)
      ctx.planner.setShowWeatherHeatmap(true)
      await ctx.sleep(900)
      ctx.spotlight({ selector: '.weather-sub-filters', label: 'Sub-filters' })
      await ctx.sleep(1200)
      ctx.planner.toggleWeatherSubFilter('rain')
      await ctx.sleep(900)
      ctx.planner.toggleWeatherSubFilter('waves')
      await ctx.sleep(900)
      ctx.planner.toggleWeatherSubFilter('rain')
      ctx.planner.toggleWeatherSubFilter('waves')
    },
  },

  {
    id: 'seaice',
    kicker: 'Sea ice',
    caption: 'Concentration shading, and the distance your track spends in it',
    dur: 6000,
    async run(ctx) {
      ctx.clearSpotlight()
      ctx.planner.setShowSeaIce(true)
      ctx.fly({ center: ANTARCTIC, zoom: 2.9, pitch: 0, duration: 3200 })
    },
  },

  {
    id: 'polaris',
    kicker: 'POLARIS ice risk',
    caption: 'The IMO risk index, re-scored for the vessel’s polar class',
    dur: 5500,
    async run(ctx) {
      ctx.planner.setShowIceRisk(true)
      await ctx.sleep(600)
      // The control is the point of this beat: the overlay itself is empty
      // until seaice_forecast is installed.
      ctx.spotlight({ selector: '.layer-list', label: 'PC1 — PC7' })
      for (const pc of ['PC7', 'PC4', 'PC1']) {
        await ctx.sleep(1400)
        ctx.planner.setPolarClass(pc)
      }
    },
  },

  {
    id: 'all',
    kicker: 'All at once',
    caption: 'Or switch the whole stack on with one button',
    dur: 4500,
    async run(ctx) {
      ctx.clearSpotlight()
      ctx.fly({ center: [40, 12], zoom: 2.4, pitch: 0, duration: 2800 })
      await ctx.sleep(900)
      quickAction('All')
      await ctx.sleep(900)
      ctx.spotlight({ selector: '.layer-panel-header', label: 'All / None' })
    },
  },

  {
    id: 'outro',
    kind: 'title',
    dur: 5000,
    letterbox: true,
    title: 'Map Data Selection',
    subtitle: 'Every layer, on your terms.',
    async run(ctx) {
      ctx.clearSpotlight()
      ctx.chrome(false)
      ctx.fly({ center: [30, 18], zoom: 1.9, pitch: 0, bearing: 0, duration: 4200 })
    },
  },
]

/** Route figures available to any scene that sets `stats: true`. */
export const STAT_CARDS = [
  { key: 'distance', label: 'Nautical miles', decimals: 0, get: (r) => r.totalDistanceNm },
  { key: 'ice', label: 'NM through sea ice', decimals: 0, get: (r) => r.totalDistanceInSeaIceNm },
  { key: 'safety', label: 'Safety score', decimals: 0, get: (r) => r.safetyScore },
  { key: 'bergs', label: 'Tracked icebergs', decimals: 0, get: (_r, p) => (p.icebergs || []).length },
]

/** Resets the app to the state every take must start from. */
export function resetForTour(planner) {
  for (let i = (planner.waypoints || []).length - 1; i >= 2; i--) planner.removeWaypoint(i)
  planner.setWaypoint(0, { label: '', countryCode: '', lat: null, lon: null, isPort: true })
  planner.setWaypoint(1, { label: '', countryCode: '', lat: null, lon: null, isPort: true })
  planner.setOptimizeFor('distance')
  planner.setIsPlaying(false)
  planner.setBasemap('google-sat')
  planner.setPolarClass('PC4')
  planner.setShowIceRisk(false)
  planner.setShowSeamarks(false)
  planner.setShowWindFlow(false)
  planner.setShowOceanCurrents(false)
  planner.setShowWind(false)
  planner.setShowWeatherHeatmap(false)
  planner.setShowStorms(false)
  planner.setShowSeaIce(false)
  planner.setShowChokepoints(false)
  planner.setShowChevrons(false)
  planner.setShowEca(false)
}
