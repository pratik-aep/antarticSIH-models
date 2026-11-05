// "Apple" basemap: a MapLibre vector style matched to Apple Maps' light
// standard map, drawn on a globe like the Maps app on Mac.
//
// Real Apple Maps tiles are only available through MapKit JS with a paid Apple
// Developer token, and MapKit JS draws a flat map (no globe). So this redraws
// free data in Apple's palette instead. Colours were sampled from Apple Maps:
//   - zoomed out: land cover tiles in /public/apple-landcover, classified from
//     public-domain Natural Earth II into Apple's flat land colours
//   - zoomed in: OpenStreetMap vector tiles from OpenFreeMap (no key)
//   - relief: AWS Terrain Tiles hillshade
//
// Every layer id starts with `basemap-apple-` so MapView's basemap switch can
// toggle the whole group, and every layer starts hidden.

const OMT = 'apple-openmaptiles'
const LANDCOVER = 'apple-landcover'
const DEM = 'apple-dem'

const C = {
  landLow: '#dfe8b1',
  rural: '#e0efc0',
  urban: '#f4f0e8',
  forest: '#c0e4a8',
  wetland: '#c6e8c8',
  park: '#c0e79f',
  sand: '#f5edd0',
  ice: '#f5f5f5',
  hospital: '#f6eeee',
  school: '#f2ecdc',
  cemetery: '#d8ebcf',
  water: '#8dd5f5',
  airport: '#dee7ed',
  runway: '#ccd8e4',
  building: '#ebe7e0',
  buildingLine: '#dfdad2',
  building3d: '#f1eee9',
  rail: '#c5c8cf',
  ferry: '#6db7dc',
  country: '#c9b1c0',
  state: '#c9b4a8',
  continentLabel: '#935d8d',
  regionLabel: '#7b335d',
  cityLabel: '#1b1b1b',
  townLabel: '#2b2b2b',
  smallLabel: '#3d3d3d',
  districtLabel: '#4a4a4a',
  waterLabel: '#5d8d9f',
  roadLabel: '#3c3c3c',
  airportLabel: '#2a63c3',
  halo: '#ffffff',
}

const FONT = {
  regular: ['Noto Sans Regular'],
  semibold: ['Open Sans Semibold'],
  bold: ['Noto Sans Bold'],
  italic: ['Noto Sans Italic'],
}

// English first, then the Latin international name, so labels match the
// English UI instead of switching script country by country.
const NAME = ['coalesce', ['get', 'name_en'], ['get', 'name_int'], ['get', 'name']]

const isLine = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false]
const isPoint = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false]
const isPolygon = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false]
const classIn = (...classes) => ['match', ['get', 'class'], classes, true, false]
const byZoom = (...stops) => ['interpolate', ['linear'], ['zoom'], ...stops]
const byZoomExp = (stops) => ['interpolate', ['exponential', 1.5], ['zoom'], ...stops.flat()]

// Tunnels stay in the same layers, just faded, instead of a parallel set.
const tunnelFade = ['case', ['==', ['get', 'brunnel'], 'tunnel'], 0.5, 1]

// Apple draws roads lavender-grey when zoomed out, grey at city zoom and white
// (with a thin grey edge) at street zoom; only the biggest roads stay grey.
const ROADS = [
  {
    key: 'minor', classes: ['minor', 'service'], minzoom: 12, casingMinzoom: 14, casing: '#e1e4e7',
    color: byZoom(12, '#d3dae0', 14, '#fcfcfc'),
    width: [[12, 0.5], [14, 2.5], [16, 6], [18, 12]],
  },
  {
    key: 'secondary', classes: ['secondary', 'tertiary'], minzoom: 9, casingMinzoom: 13.5, casing: '#dee1e4',
    color: byZoom(9, '#bcc4d8', 12, '#c6ced6', 14, '#fcfcfc'),
    width: [[9, 0.4], [12, 2], [14, 4], [16, 8], [18, 16]],
  },
  {
    key: 'primary', classes: ['primary'], minzoom: 7, casingMinzoom: 13.5, casing: '#dadde1',
    color: byZoom(7, '#b3bcd3', 12, '#b7bdc6', 14.5, '#fcfcfc'),
    width: [[7, 0.7], [10, 1.4], [12, 2.8], [14, 5], [16, 10], [18, 20]],
  },
  {
    key: 'motorway', classes: ['motorway', 'trunk'], minzoom: 5, casingMinzoom: 13.5, casing: '#b4b7ba',
    color: byZoom(5, '#a5b1cc', 10, '#aab3c5', 12, '#b1b7c0', 15, '#cccfd2'),
    width: [[5, 0.7], [8, 1.9], [10, 2.5], [12, 4], [14, 6], [16, 12], [18, 24]],
  },
]

// A casing is its road plus a rim on each side. MapLibre can't add two zoom
// curves together, so the rim is baked into each stop instead.
const widen = (stops) => stops.map(([z, w]) => [z, w + (z <= 12 ? 1 : z <= 15 ? 2 : 3)])

function roadLayers() {
  const base = r => ({
    type: 'line',
    source: OMT,
    'source-layer': 'transportation',
    filter: ['all', isLine, classIn(...r.classes)],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  })
  const casings = ROADS.map(r => ({
    ...base(r),
    id: `basemap-apple-road-${r.key}-casing`,
    minzoom: r.casingMinzoom,
    paint: { 'line-color': r.casing, 'line-width': byZoomExp(widen(r.width)), 'line-opacity': tunnelFade },
  }))
  const fills = ROADS.map(r => ({
    ...base(r),
    id: `basemap-apple-road-${r.key}`,
    minzoom: r.minzoom,
    paint: { 'line-color': r.color, 'line-width': byZoomExp(r.width), 'line-opacity': tunnelFade },
  }))
  return [...casings, ...fills]
}

// Apple's place icons: a coloured badge with a white pictogram, and the label
// drawn in the badge colour.
const POI = [
  { key: 'food', glyph: 'food', color: '#f5891f', text: '#c5620a',
    classes: ['restaurant', 'fast_food', 'food_court', 'bar', 'beer', 'pub', 'ice_cream', 'bakery', 'cafe'] },
  { key: 'shop', glyph: 'bag', color: '#f2b705', text: '#9a7200',
    classes: ['shop', 'grocery', 'clothing_store', 'alcohol_shop', 'jewelry', 'hardware', 'furniture', 'florist', 'mobile_phone', 'books', 'toys', 'gift'] },
  { key: 'landmark', glyph: 'star', color: '#5a6ad9', text: '#4453c2',
    classes: ['attraction', 'monument', 'castle', 'memorial', 'viewpoint'] },
  { key: 'culture', glyph: 'museum', color: '#e0529c', text: '#c23a82',
    classes: ['museum', 'art_gallery', 'theatre', 'cinema', 'music', 'library'] },
  { key: 'transit', glyph: 'train', color: '#3b82f6', text: '#2a63c3', square: true,
    classes: ['railway', 'bus', 'ferry_terminal', 'harbor', 'aerialway'] },
  { key: 'park', glyph: 'tree', color: '#3fae55', text: '#2f8a43',
    classes: ['park', 'garden', 'playground', 'zoo', 'golf', 'campsite', 'stadium', 'swimming'] },
  { key: 'health', glyph: 'cross', color: '#ec5b53', text: '#c9372f',
    classes: ['hospital', 'pharmacy', 'dentist', 'doctors', 'veterinary'] },
  { key: 'lodging', glyph: 'bed', color: '#8e63d6', text: '#7148b8',
    classes: ['lodging', 'hotel', 'motel', 'hostel'] },
  { key: 'education', glyph: 'cap', color: '#a37b58', text: '#86613f',
    classes: ['school', 'college', 'university', 'kindergarten'] },
  { key: 'civic', glyph: 'museum', color: '#8e8e93', text: '#636366',
    classes: ['town_hall', 'police', 'fire_station', 'post', 'embassy', 'place_of_worship'] },
]

const poiMatch = (pick) => ['match', ['get', 'class'], ...POI.flatMap(p => [p.classes, pick(p)]), pick(null)]

// Apple adds place badges as you zoom in, most important first.
const POI_TIERS = [
  { key: 'major', minzoom: 15, maxRank: 3, only: ['landmark', 'culture', 'transit', 'park'] },
  { key: 'mid', minzoom: 16.5, maxRank: 12 },
  { key: 'all', minzoom: 18, maxRank: 1000 },
]

function poiLayers() {
  return POI_TIERS.map((tier, i) => ({
    id: `basemap-apple-label-poi-${tier.key}`,
    type: 'symbol',
    source: OMT,
    'source-layer': 'poi',
    minzoom: tier.minzoom,
    filter: ['all', isPoint,
      ['match', ['get', 'class'], POI.filter(p => !tier.only || tier.only.includes(p.key)).flatMap(p => p.classes), true, false],
      ['<=', ['coalesce', ['get', 'rank'], 1000], tier.maxRank],
      ['>', ['coalesce', ['get', 'rank'], 1000], i === 0 ? -1 : POI_TIERS[i - 1].maxRank]],
    layout: {
      'icon-image': poiMatch(p => (p ? `apple-poi-${p.key}` : '')),
      'text-field': NAME,
      'text-font': FONT.bold,
      'text-size': 11,
      'text-max-width': 8,
      'text-variable-anchor': ['left', 'right', 'top'],
      'text-radial-offset': 0.95,
      'text-justify': 'auto',
      'text-padding': 8,
      'symbol-sort-key': ['coalesce', ['get', 'rank'], 1000],
    },
    paint: {
      'text-color': poiMatch(p => (p ? p.text : '#636366')),
      'text-halo-color': C.halo,
      'text-halo-width': 1.4,
    },
  }))
}

// Apple reveals cities by importance as you zoom in; OpenMapTiles ranks them
// (1 = most important).
const CITY_TIERS = [
  { key: 'major', minzoom: 2, rank: ['<=', ['coalesce', ['get', 'rank'], 99], 3] },
  { key: 'mid', minzoom: 4.5, rank: ['all', ['>', ['coalesce', ['get', 'rank'], 99], 3], ['<=', ['coalesce', ['get', 'rank'], 99], 7]] },
  { key: 'minor', minzoom: 6.5, rank: ['>', ['coalesce', ['get', 'rank'], 99], 7] },
]

function cityLayers() {
  const major = ['<=', ['coalesce', ['get', 'rank'], 99], 3]
  return CITY_TIERS.map(tier => label(`city-${tier.key}`, 'place', ['all', classIn('city'), tier.rank],
    {
      'icon-image': ['step', ['zoom'], 'apple-dot', 11, ''],
      'text-font': ['case', major, ['literal', FONT.bold], ['literal', FONT.semibold]],
      'text-size': byZoom(2, ['case', major, 11, 10], 6, ['case', major, 15, 12], 11, ['case', major, 19, 14.5]),
      'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
      'text-radial-offset': ['step', ['zoom'], 0.5, 11, 0],
      'text-justify': 'auto',
      'text-padding': 6,
      'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
    },
    {},
    { minzoom: tier.minzoom }))
}

const fill = (id, sourceLayer, filter, color, extra = {}) => ({
  id: `basemap-apple-${id}`,
  type: 'fill',
  source: OMT,
  'source-layer': sourceLayer,
  ...(filter ? { filter } : {}),
  ...extra,
  paint: { 'fill-color': color, 'fill-antialias': false, ...(extra.paint || {}) },
})

const label = (id, sourceLayer, filter, layout, paint, extra = {}) => ({
  id: `basemap-apple-label-${id}`,
  type: 'symbol',
  source: OMT,
  'source-layer': sourceLayer,
  ...(filter ? { filter } : {}),
  ...extra,
  layout: { 'text-field': NAME, 'text-font': FONT.semibold, 'text-max-width': 8, ...layout },
  paint: { 'text-color': C.cityLabel, 'text-halo-color': C.halo, 'text-halo-width': 1.3, 'text-halo-blur': 0.3, ...paint },
})

function assetUrl(path) {
  const base = (import.meta.env && import.meta.env.BASE_URL) || '/'
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}${base}${path}`
}

export const APPLE_SOURCES = {
  [OMT]: {
    type: 'vector',
    url: 'https://tiles.openfreemap.org/planet',
  },
  [LANDCOVER]: {
    type: 'raster',
    tiles: [assetUrl('apple-landcover/{z}/{x}/{y}.png')],
    tileSize: 512,
    maxzoom: 4,
    attribution: 'Natural Earth',
  },
  [DEM]: {
    type: 'raster-dem',
    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
    encoding: 'terrarium',
    tileSize: 256,
    maxzoom: 12,
    attribution: 'Terrain Tiles (AWS Open Data)',
  },
}

const layers = [
  { id: 'basemap-apple-background', type: 'background', paint: { 'background-color': byZoom(6, C.landLow, 8, C.rural, 11, C.rural, 13, C.urban) } },
  {
    id: 'basemap-apple-landcover',
    type: 'raster',
    source: LANDCOVER,
    maxzoom: 9,
    paint: { 'raster-opacity': byZoom(5.5, 1, 8, 0), 'raster-fade-duration': 0 },
  },

  fill('landcover-grass', 'landcover', classIn('grass', 'farmland', 'scrub'), C.rural, { minzoom: 11 }),
  fill('landcover-forest', 'landcover', classIn('wood', 'forest'), C.forest,
    { minzoom: 6, paint: { 'fill-opacity': byZoom(6, 0, 8, 1) } }),
  fill('landcover-wetland', 'landcover', classIn('wetland'), C.wetland, { minzoom: 8 }),
  fill('landcover-sand', 'landcover', classIn('sand'), C.sand, { minzoom: 6 }),
  fill('landcover-ice', 'landcover', classIn('ice'), C.ice, { minzoom: 5 }),
  fill('landuse-urban', 'landuse', classIn('residential', 'suburb', 'neighbourhood', 'commercial', 'industrial', 'retail', 'railway', 'garages'), C.urban,
    { minzoom: 8, paint: { 'fill-opacity': byZoom(8, 0, 10, 1) } }),
  fill('landuse-hospital', 'landuse', classIn('hospital'), C.hospital, { minzoom: 13 }),
  fill('landuse-school', 'landuse', classIn('school', 'university', 'college', 'kindergarten'), C.school, { minzoom: 13 }),
  fill('landuse-cemetery', 'landuse', classIn('cemetery'), C.cemetery, { minzoom: 13 }),
  fill('park', 'park', isPolygon, C.park, { minzoom: 6, paint: { 'fill-opacity': byZoom(6, 0, 9, 1) } }),

  {
    // Apple's soft terrain relief, strongest in the mid zooms.
    id: 'basemap-apple-hillshade',
    type: 'hillshade',
    source: DEM,
    paint: {
      'hillshade-exaggeration': byZoom(2, 0.2, 7, 0.5, 12, 0.35),
      'hillshade-shadow-color': 'rgba(60, 80, 48, 0.40)',
      'hillshade-highlight-color': 'rgba(255, 255, 255, 0.28)',
      'hillshade-accent-color': 'rgba(64, 84, 52, 0.10)',
      'hillshade-illumination-direction': 315,
    },
  },

  fill('water', 'water', ['!=', ['get', 'brunnel'], 'tunnel'], C.water, { paint: { 'fill-antialias': true } }),
  {
    id: 'basemap-apple-waterway',
    type: 'line',
    source: OMT,
    'source-layer': 'waterway',
    minzoom: 7,
    filter: ['!=', ['get', 'brunnel'], 'tunnel'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': C.water,
      'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 8, ['match', ['get', 'class'], 'river', 0.8, 0.3], 18, ['match', ['get', 'class'], 'river', 14, 4]],
    },
  },

  fill('aeroway-area', 'aeroway', isPolygon, C.airport, { minzoom: 10 }),
  {
    id: 'basemap-apple-aeroway-runway',
    type: 'line',
    source: OMT,
    'source-layer': 'aeroway',
    minzoom: 11,
    filter: ['all', isLine, classIn('runway', 'taxiway')],
    paint: {
      'line-color': C.runway,
      'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 11, ['match', ['get', 'class'], 'runway', 1.5, 0.5], 17, ['match', ['get', 'class'], 'runway', 40, 12]],
    },
  },

  {
    id: 'basemap-apple-path',
    type: 'line',
    source: OMT,
    'source-layer': 'transportation',
    minzoom: 15,
    filter: ['all', isLine, classIn('path', 'pedestrian', 'track')],
    paint: { 'line-color': '#ffffff', 'line-width': byZoom(15, 1, 18, 3) },
  },
  ...roadLayers(),
  {
    id: 'basemap-apple-rail',
    type: 'line',
    source: OMT,
    'source-layer': 'transportation',
    minzoom: 12,
    filter: ['all', isLine, classIn('rail', 'transit')],
    paint: { 'line-color': C.rail, 'line-width': byZoom(12, 0.6, 16, 2) },
  },
  {
    id: 'basemap-apple-ferry',
    type: 'line',
    source: OMT,
    'source-layer': 'transportation',
    minzoom: 7,
    filter: ['all', isLine, classIn('ferry')],
    paint: { 'line-color': C.ferry, 'line-width': byZoom(7, 0.5, 14, 1.2), 'line-opacity': 0.55 },
  },

  fill('building', 'building', null, C.building,
    { minzoom: 15.5, maxzoom: 16.5, paint: { 'fill-outline-color': C.buildingLine, 'fill-antialias': true, 'fill-opacity': byZoom(15.5, 0, 16, 1) } }),
  {
    // Flat from straight above; tilt the map (right-drag) for Apple-style 3D blocks.
    id: 'basemap-apple-building-3d',
    type: 'fill-extrusion',
    source: OMT,
    'source-layer': 'building',
    minzoom: 16,
    filter: ['!=', ['get', 'hide_3d'], true],
    paint: {
      'fill-extrusion-color': C.building3d,
      'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': 0.95,
    },
  },

  {
    id: 'basemap-apple-boundary-state',
    type: 'line',
    source: OMT,
    'source-layer': 'boundary',
    minzoom: 3.5,
    filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
    paint: { 'line-color': C.state, 'line-width': byZoom(4, 0.5, 8, 1.1, 12, 1.6) },
  },
  {
    id: 'basemap-apple-boundary-country',
    type: 'line',
    source: OMT,
    'source-layer': 'boundary',
    filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1], ['!=', ['get', 'disputed'], 1]],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': C.country, 'line-width': byZoom(0, 0.5, 3, 0.8, 6, 1.2, 10, 1.8) },
  },
  {
    id: 'basemap-apple-boundary-disputed',
    type: 'line',
    source: OMT,
    'source-layer': 'boundary',
    filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1], ['==', ['get', 'disputed'], 1]],
    paint: { 'line-color': C.country, 'line-dasharray': [3, 2], 'line-width': byZoom(0, 0.5, 6, 1.1, 10, 1.6) },
  },

  label('waterway', 'waterway', classIn('river'),
    { 'symbol-placement': 'line', 'text-font': FONT.italic, 'text-size': 10.5, 'text-letter-spacing': 0.05 },
    { 'text-color': C.waterLabel, 'text-halo-width': 0 },
    { minzoom: 10 }),
  label('ocean', 'water_name', ['all', isPoint, classIn('ocean')],
    { 'text-font': FONT.italic, 'text-size': byZoom(1, 11, 5, 14), 'text-letter-spacing': 0.12, 'text-max-width': 6 },
    { 'text-color': C.waterLabel, 'text-halo-width': 0 }),
  label('sea', 'water_name', ['all', isPoint, ['!', classIn('ocean')]],
    { 'text-font': FONT.italic, 'text-size': byZoom(4.5, 10.5, 8, 12.5), 'text-letter-spacing': 0.1, 'text-max-width': 6 },
    { 'text-color': C.waterLabel, 'text-halo-width': 0 },
    { minzoom: 4.5 }),
  ...poiLayers(),
  label('road-major', 'transportation_name', classIn('motorway', 'trunk', 'primary'),
    {
      'symbol-placement': 'line',
      'text-font': FONT.bold,
      'text-size': byZoom(13, 9, 16, 11),
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.06,
      'text-rotation-alignment': 'map',
      'symbol-spacing': 400,
    },
    { 'text-color': C.roadLabel, 'text-halo-width': 1.5 },
    { minzoom: 13 }),
  label('road', 'transportation_name', ['!', classIn('motorway', 'trunk', 'primary', 'rail', 'transit', 'ferry')],
    {
      'symbol-placement': 'line',
      'text-font': FONT.bold,
      'text-size': byZoom(12, 9, 16, 11),
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.06,
      'text-rotation-alignment': 'map',
    },
    { 'text-color': C.roadLabel, 'text-halo-width': 1.5 },
    { minzoom: 15.5 }),
  {
    // Yellow route shields, e.g. "NH 48" stacked like Apple's.
    id: 'basemap-apple-label-shield',
    type: 'symbol',
    source: OMT,
    'source-layer': 'transportation_name',
    minzoom: 9,
    filter: ['all', ['has', 'ref'], ['<=', ['coalesce', ['get', 'ref_length'], 9], 5], classIn('motorway', 'trunk')],
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 1600,
      'icon-padding': 80,
      'icon-image': 'apple-shield',
      'icon-text-fit': 'both',
      'icon-text-fit-padding': [2, 3, 1, 3],
      'icon-rotation-alignment': 'viewport',
      'text-rotation-alignment': 'viewport',
      'text-field': ['get', 'ref'],
      'text-font': FONT.bold,
      'text-size': 8.5,
      'text-max-width': 2,
      'text-line-height': 1.05,
    },
    paint: { 'text-color': '#2b2100' },
  },
  label('airport', 'aerodrome_label', null,
    {
      'icon-image': 'apple-airport',
      'text-font': FONT.bold,
      'text-size': 11,
      'text-anchor': 'top',
      'text-offset': [0, 1.2],
      'text-max-width': 9,
    },
    { 'text-color': C.airportLabel, 'text-halo-width': 1.4 },
    { minzoom: 9 }),
  label('neighbourhood', 'place', classIn('suburb', 'quarter', 'neighbourhood'),
    { 'text-font': FONT.bold, 'text-size': byZoom(12, 9.5, 16, 11.5), 'text-transform': 'uppercase', 'text-letter-spacing': 0.06, 'text-max-width': 7 },
    { 'text-color': C.districtLabel },
    { minzoom: 13.5 }),
  label('village', 'place', classIn('village', 'hamlet'),
    { 'text-size': byZoom(10, 10.5, 15, 12.5) },
    { 'text-color': C.smallLabel },
    { minzoom: 11.5 }),
  label('island', 'place', classIn('island'),
    { 'text-size': byZoom(7, 10, 12, 12.5) },
    { 'text-color': C.smallLabel },
    { minzoom: 7 }),
  label('town', 'place', classIn('town'),
    {
      'icon-image': ['step', ['zoom'], 'apple-dot-small', 11, ''],
      'text-size': byZoom(6, 10.5, 12, 13),
      'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
      'text-radial-offset': ['step', ['zoom'], 0.4, 11, 0],
      'text-justify': 'auto',
      'text-padding': 6,
    },
    { 'text-color': C.townLabel },
    { minzoom: 8.5 }),
  ...cityLayers(),
  label('state', 'place', classIn('state'),
    { 'text-font': FONT.bold, 'text-size': byZoom(4, 9, 7, 11), 'text-transform': 'uppercase', 'text-letter-spacing': 0.03, 'text-max-width': 7 },
    { 'text-color': C.regionLabel, 'text-halo-width': 1 },
    { minzoom: 4, maxzoom: 8 }),
  label('country', 'place', classIn('country'),
    {
      'text-font': FONT.bold,
      'text-size': byZoom(3, 9.5, 6, 12),
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.03,
      'text-max-width': 6,
      'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
    },
    { 'text-color': C.regionLabel, 'text-halo-width': 1 },
    { minzoom: 3.5, maxzoom: 7 }),
  // Apple labels Australia as a continent but never "Oceania".
  label('continent', 'place', ['all', classIn('continent'), ['!=', ['coalesce', ['get', 'name_en'], ['get', 'name']], 'Oceania']],
    { 'text-font': FONT.bold, 'text-size': 11.5, 'text-transform': 'uppercase', 'text-letter-spacing': 0.04 },
    { 'text-color': C.continentLabel, 'text-halo-width': 1 },
    { maxzoom: 3.5 }),
]

// Hidden until the Apple basemap is picked.
export const APPLE_LAYERS = layers.map(l => ({ ...l, layout: { ...(l.layout || {}), visibility: 'none' } }))

// ---- icons, drawn once on a canvas at 2x ---------------------------------

const RATIO = 2

function canvas(w, h) {
  const c = document.createElement('canvas')
  c.width = w * RATIO
  c.height = h * RATIO
  const g = c.getContext('2d')
  g.scale(RATIO, RATIO)
  return [c, g]
}

const pixels = (c, g) => g.getImageData(0, 0, c.width, c.height)

function drawGlyph(g, glyph, cx, cy) {
  g.save()
  g.translate(cx, cy)
  g.fillStyle = '#ffffff'
  g.strokeStyle = '#ffffff'
  g.lineWidth = 1.4
  g.lineCap = 'round'
  g.lineJoin = 'round'
  const path = (fn) => { g.beginPath(); fn(); }
  switch (glyph) {
    case 'food':
      path(() => { g.moveTo(-2.5, -4.5); g.lineTo(-2.5, 4.5); g.moveTo(-4, -4.5); g.lineTo(-4, -1.5); g.moveTo(-1, -4.5); g.lineTo(-1, -1.5); g.moveTo(-4, -1.5); g.quadraticCurveTo(-2.5, 0, -1, -1.5) }); g.stroke()
      path(() => { g.moveTo(2.8, 4.5); g.lineTo(2.8, -4.5); g.quadraticCurveTo(5, -2, 4.2, 0.5); g.lineTo(2.8, 0.5) }); g.stroke()
      break
    case 'bag':
      path(() => { g.rect(-4, -1.5, 8, 6) }); g.fill()
      path(() => { g.arc(0, -1.5, 2.4, Math.PI, 0) }); g.stroke()
      break
    case 'star':
      path(() => {
        for (let i = 0; i < 10; i += 1) {
          const r = i % 2 ? 2.3 : 5.2
          const a = -Math.PI / 2 + (i * Math.PI) / 5
          g.lineTo(Math.cos(a) * r, Math.sin(a) * r)
        }
        g.closePath()
      }); g.fill()
      break
    case 'museum':
      path(() => { g.moveTo(-5, -1.8); g.lineTo(0, -5); g.lineTo(5, -1.8); g.closePath() }); g.fill()
      path(() => { g.rect(-5, 3.2, 10, 1.4) }); g.fill()
      for (const x of [-3.4, 0, 3.4]) { path(() => { g.rect(x - 0.7, -1, 1.4, 4) }); g.fill() }
      break
    case 'train':
      path(() => { g.roundRect(-3.8, -5, 7.6, 8, 1.8) }); g.fill()
      g.fillStyle = 'rgba(0,0,0,0.28)'
      path(() => { g.rect(-2.6, -3.6, 5.2, 2.8) }); g.fill()
      g.fillStyle = '#ffffff'
      path(() => { g.moveTo(-2.6, 3); g.lineTo(-3.8, 5.2); g.moveTo(2.6, 3); g.lineTo(3.8, 5.2) }); g.stroke()
      break
    case 'tree':
      path(() => { g.arc(0, -1.4, 3.8, 0, Math.PI * 2) }); g.fill()
      path(() => { g.rect(-0.8, 1.5, 1.6, 3.5) }); g.fill()
      break
    case 'cross':
      path(() => { g.rect(-1.5, -4.8, 3, 9.6); g.rect(-4.8, -1.5, 9.6, 3) }); g.fill()
      break
    case 'bed':
      path(() => { g.rect(-5, 0, 10, 2.8); g.rect(-5, -3.5, 1.4, 8); g.rect(3.6, 2, 1.4, 2.5) }); g.fill()
      path(() => { g.roundRect(-3.2, -2.2, 3.2, 2, 0.8) }); g.fill()
      break
    case 'cap':
      path(() => { g.moveTo(-5.5, -1); g.lineTo(0, -3.8); g.lineTo(5.5, -1); g.lineTo(0, 1.8); g.closePath() }); g.fill()
      path(() => { g.moveTo(-3, 0.5); g.lineTo(-3, 3); g.quadraticCurveTo(0, 5, 3, 3); g.lineTo(3, 0.5) }); g.fill()
      break
    case 'plane':
      g.rotate(Math.PI / 4)
      path(() => {
        g.moveTo(0, -6); g.quadraticCurveTo(1, -6, 1, -4.5); g.lineTo(1, -1.2); g.lineTo(6, 1.5); g.lineTo(6, 2.8); g.lineTo(1, 1.3)
        g.lineTo(1, 4); g.lineTo(2.4, 5.2); g.lineTo(2.4, 6.2); g.lineTo(0, 5.4); g.lineTo(-2.4, 6.2); g.lineTo(-2.4, 5.2); g.lineTo(-1, 4)
        g.lineTo(-1, 1.3); g.lineTo(-6, 2.8); g.lineTo(-6, 1.5); g.lineTo(-1, -1.2); g.lineTo(-1, -4.5); g.quadraticCurveTo(-1, -6, 0, -6)
      }); g.fill()
      break
    default:
      path(() => { g.arc(0, 0, 2.2, 0, Math.PI * 2) }); g.fill()
  }
  g.restore()
}

function badge(color, glyph, square) {
  const size = 20
  const [c, g] = canvas(size, size)
  g.shadowColor = 'rgba(0,0,0,0.25)'
  g.shadowBlur = 1.5
  g.shadowOffsetY = 0.5
  g.fillStyle = '#ffffff'
  g.beginPath()
  if (square) g.roundRect(1, 1, 18, 18, 5)
  else g.arc(10, 10, 9, 0, Math.PI * 2)
  g.fill()
  g.shadowColor = 'transparent'
  g.fillStyle = color
  g.beginPath()
  if (square) g.roundRect(2.2, 2.2, 15.6, 15.6, 4)
  else g.arc(10, 10, 7.8, 0, Math.PI * 2)
  g.fill()
  drawGlyph(g, glyph, 10, 10)
  return pixels(c, g)
}

function cityDot(radius, ring) {
  const size = radius * 2 + 4
  const [c, g] = canvas(size, size)
  g.beginPath()
  g.arc(size / 2, size / 2, radius, 0, Math.PI * 2)
  if (ring) {
    g.fillStyle = '#ffffff'
    g.fill()
    g.lineWidth = 1.3
    g.strokeStyle = '#222222'
    g.stroke()
  } else {
    g.fillStyle = '#2b2b2b'
    g.fill()
    g.lineWidth = 0.8
    g.strokeStyle = '#ffffff'
    g.stroke()
  }
  return pixels(c, g)
}

function shield() {
  const [c, g] = canvas(20, 16)
  g.fillStyle = '#f5c231'
  g.strokeStyle = '#a57c00'
  g.lineWidth = 1
  g.beginPath()
  g.roundRect(1, 1, 18, 14, 3)
  g.fill()
  g.stroke()
  return pixels(c, g)
}

// Icons referenced by the layers above; MapView registers them on load.
export function appleImages() {
  if (typeof document === 'undefined') return []
  const images = [
    { id: 'apple-dot', data: cityDot(3, true) },
    { id: 'apple-dot-small', data: cityDot(1.8, false) },
    { id: 'apple-airport', data: badge('#3b82f6', 'plane', true) },
    // Stretch only the middle of the shield so its rounded corners survive
    // icon-text-fit around refs of any length.
    { id: 'apple-shield', data: shield(), options: { stretchX: [[5 * RATIO, 15 * RATIO]], stretchY: [[5 * RATIO, 11 * RATIO]], content: [3 * RATIO, 3 * RATIO, 17 * RATIO, 13 * RATIO] } },
    ...POI.map(p => ({ id: `apple-poi-${p.key}`, data: badge(p.color, p.glyph, p.square) })),
  ]
  return images.map(img => ({ ...img, options: { pixelRatio: RATIO, ...(img.options || {}) } }))
}
