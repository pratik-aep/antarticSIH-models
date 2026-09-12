import React, { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { fetchEcas, fetchChokepoints, geocode } from '../api'
import { usePlanner } from '../store'
import { unwrapLongitudes, splitIntoRenderedParts } from '../geo'

const MAX_WAYPOINTS = 8

const PIN_BLUE = '#1452c4'
const PIN_WHITE = '#ffffff'

function basemapStyle() {
  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      'basemap-standard': {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
        maxzoom: 19,
      },
      'basemap-light': {
        type: 'raster',
        tiles: ['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© CARTO · © OpenStreetMap contributors',
        maxzoom: 20,
      },
    },
    layers: [
      { id: 'basemap-standard', type: 'raster', source: 'basemap-standard' },
      { id: 'basemap-light', type: 'raster', source: 'basemap-light', layout: { visibility: 'none' } },
    ],
  }
}

export default function MapView() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const {
    waypoints, addWaypoint, route, routeLoading,
    basemap, showEca, showChokepoints, showChevrons,
  } = usePlanner()

  const addRef = useRef(addWaypoint)
  addRef.current = addWaypoint
  const wpLenRef = useRef(waypoints.length)
  wpLenRef.current = waypoints.length

  // Always holds a fn drawing the *current* route into the map source, so it
  // can be called right after `load` too (waypoints may be set before then).
  const drawRouteRef = useRef(() => {})

  // ---- init once ----
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: basemapStyle(),
      center: [66, 12],
      zoom: 2.4,
      attributionControl: { compact: false },
    })
    mapRef.current = map

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'nautical' }), 'bottom-left')
    map.addControl(new maplibregl.AttributionControl({ compact: false }))

    map.on('load', () => {
      // No runtime addImage() here: MapLibre v4.7 throws an atlas "mismatched
      // image size" assertion when a canvas image is uploaded during/after the
      // render frame. Pins and route arrows are drawn with vector/text layers
      // instead, which skip image upload entirely and are reliable.

      map.addSource('route', { type: 'geojson', data: emptyFeatureCollection() })
      map.addLayer({
        id: 'route-outline',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': 'rgba(20,40,80,0.25)', 'line-width': 7 },
      })
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': PIN_BLUE, 'line-width': 2.6 },
      })
      map.addLayer({
        id: 'route-chevrons',
        type: 'symbol',
        source: 'route',
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 72,
          'text-field': ['literal', '»'],
          'text-size': 13,
          'text-font': ['Noto Sans Bold'],
          'text-rotation-alignment': 'auto',
          'icon-rotation-alignment': 'map',
          'text-allow-overlap': false,
        },
        paint: { 'text-color': PIN_BLUE },
      })

      map.addSource('waypoints', { type: 'geojson', data: emptyFeatureCollection() })
      map.addLayer({
        id: 'wp-halo',
        type: 'circle',
        source: 'waypoints',
        paint: {
          'circle-radius': 11,
          'circle-color': PIN_WHITE,
          'circle-stroke-width': 2,
          'circle-stroke-color': PIN_BLUE,
        },
      })
      map.addLayer({
        id: 'wp-dot',
        type: 'circle',
        source: 'waypoints',
        paint: { 'circle-radius': 8.5, 'circle-color': PIN_BLUE },
      })
      map.addLayer({
        id: 'wp-number',
        type: 'symbol',
        source: 'waypoints',
        layout: {
          'text-field': ['get', 'rank'],
          'text-size': 11,
          'text-font': ['Noto Sans Bold'],
          'text-allow-overlap': true,
          'text-padding': 0,
        },
        paint: { 'text-color': PIN_WHITE },
      })

      map.addSource('ecas', { type: 'geojson', data: emptyFeatureCollection() })
      map.addLayer({
        id: 'eca-fill',
        type: 'fill',
        source: 'ecas',
        paint: { 'fill-color': '#ff7a00', 'fill-opacity': 0.08 },
      })
      map.addLayer({
        id: 'eca-outline',
        type: 'line',
        source: 'ecas',
        paint: { 'line-color': '#ff7a00', 'line-width': 1.6, 'line-opacity': 0.95 },
      })

      map.addSource('chokepoints', { type: 'geojson', data: emptyFeatureCollection() })
      map.addLayer({
        id: 'chokepoints',
        type: 'line',
        source: 'chokepoints',
        paint: { 'line-color': '#d33', 'line-width': 1.5, 'line-dasharray': [3, 2] },
      })

      map.on('click', async (e) => {
        if (wpLenRef.current >= MAX_WAYPOINTS) return
        const { lat, lng } = e.lngLat
        try {
          const place = await geocode(lat.toFixed(4), lng.toFixed(4))
          addRef.current({ label: place.label, countryCode: place.countryCode || '', lat: place.lat, lon: place.lon, isPort: !!place.isPort })
        } catch { /* ignore */ }
      })
      map.getCanvas().style.cursor = 'crosshair'
      drawRouteRef.current() // route may be ready before tiles loaded
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // ---- route geometry (multi-part for antimeridian crossing) ----
  useEffect(() => {
    drawRouteRef.current = () => {
      const map = mapRef.current
      if (!map || !map.getSource('route')) return
      let geo
      if (!route || !route.legs || !route.legs.length) {
        geo = emptyFeatureCollection()
      } else {
        // Concatenate all legs' sampled geodesics, deduping the shared endpoint.
        let pts = []
        for (const leg of route.legs) {
          const legPts = leg.path.map(([lat, lon]) => [lat, lon]) // already [lat,lon]
          if (pts.length && samePoint(pts[pts.length - 1], legPts[0])) legPts.shift()
          pts.push(...legPts)
        }
        if (pts.length < 2) {
          geo = emptyFeatureCollection()
        } else {
          // Unwrap longitudes so great circles crossing the antimeridian stay
          // contiguous, then split into per-world-copy parts for correct drawing.
          const unwrapped = unwrapLongitudes(pts)
          const parts = splitIntoRenderedParts(unwrapped)

          geo = parts.length === 1
            ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: parts[0] } }
            : { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: parts } }
        }
      }
      map.getSource('route').setData(geo)
    }
    const map = mapRef.current
    if (map && map.getSource('route')) drawRouteRef.current()
    return () => { drawRouteRef.current = () => {} }
  }, [route])

  // ---- waypoint pins ----
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getSource('waypoints')) return
    const features = waypoints
      .filter(w => typeof w.lat === 'number')
      .map((w, i) => ({
        type: 'Feature',
        properties: { rank: String(i + 1), label: w.label },
        geometry: { type: 'Point', coordinates: [w.lon, w.lat] },
      }))
    map.getSource('waypoints').setData({ type: 'FeatureCollection', features })
  }, [waypoints])

  // ---- ECA + chokepoints data ----
  useEffect(() => {
    let alive = true
    fetchEcas().then(fc => {
      if (!alive || !mapRef.current || !mapRef.current.getSource('ecas')) return
      mapRef.current.getSource('ecas').setData(fc)
    }).catch(() => {})
    fetchChokepoints().then(fc => {
      if (!alive || !mapRef.current || !mapRef.current.getSource('chokepoints')) return
      mapRef.current.getSource('chokepoints').setData(fc)
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('eca-outline')) return
    map.setLayoutProperty('eca-fill', 'visibility', showEca ? 'visible' : 'none')
    map.setLayoutProperty('eca-outline', 'visibility', showEca ? 'visible' : 'none')
  }, [showEca])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('chokepoints')) return
    map.setLayoutProperty('chokepoints', 'visibility', showChokepoints ? 'visible' : 'none')
  }, [showChokepoints])

  // ---- chevrons toggle ----
  const chevronsVisible = showChevrons && !!route
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('route-chevrons')) return
    map.setLayoutProperty('route-chevrons', 'visibility', chevronsVisible ? 'visible' : 'none')
  }, [chevronsVisible])

  // ---- basemap switch ----
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('basemap-standard')) return
    const target = `basemap-${basemap}`
    map.setLayoutProperty('basemap-standard', 'visibility', target === 'basemap-standard' ? 'visible' : 'none')
    map.setLayoutProperty('basemap-light', 'visibility', target === 'basemap-light' ? 'visible' : 'none')
  }, [basemap])

  // ---- fit to route once computed (not on every keystroke) ----
  const fittedRef = useRef('')

  useEffect(() => {
    const map = mapRef.current
    if (!map || !route) return
    const sig = route.legs.map(l => `${l.from.label}:${l.to.label}`).join('|')
    if (fittedRef.current === sig) return
    fittedRef.current = sig
    const pts = route.legs.flatMap(l => l.path)
    if (!pts.length) return
    const lats = pts.map(p => p[0])
    const lons = pts.map(p => p[1])
    const pad = 3
    map.fitBounds(
      [[Math.min(...lons) - pad, Math.min(...lats) - pad], [Math.max(...lons) + pad, Math.max(...lats) + pad]],
      { duration: 800, padding: 24 },
    )
  }, [route])

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map" />
      <div className="map-hint">Click the map to add a waypoint</div>
      {routeLoading && <div className="routing-indicator"><span className="spinner" /> Routing…</div>}
    </div>
  )
}

function emptyFeatureCollection() {
  return { type: 'FeatureCollection', features: [] }
}

function samePoint(a, b) {
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9
}