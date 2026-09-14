import React, { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { fetchEcas, fetchChokepoints, fetchSeaIce, fetchOceanCurrents, fetchWind, geocode } from '../api'
import { usePlanner } from '../store'
import LayerControlPanel from './LayerControlPanel'
import { unwrapLongitudes, splitIntoRenderedParts } from '../geo'
import { getShipPositionAtTime, getIcebergPositionAtTime } from '../utils'

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
      'basemap-ocean': {
        type: 'raster',
        tiles: ['https://services.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: '© Esri · GEBCO, NOAA, CHS, National Geographic',
        maxzoom: 16,
      },
      'basemap-arctic': {
        type: 'raster',
        tiles: ['https://services.arcgisonline.com/arcgis/rest/services/Polar/Arctic_Ocean_Base/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: '© Esri · GEBCO, NOAA, National Geographic',
        maxzoom: 16,
      },
      'basemap-antarctic': {
        type: 'raster',
        tiles: ['https://services.arcgisonline.com/arcgis/rest/services/Polar/Antarctic_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: '© Esri · Antarctic Imagery',
        maxzoom: 16,
      },
    },
    layers: [
      { id: 'basemap-standard', type: 'raster', source: 'basemap-standard' },
      { id: 'basemap-light', type: 'raster', source: 'basemap-light', layout: { visibility: 'none' } },
      { id: 'basemap-ocean', type: 'raster', source: 'basemap-ocean', layout: { visibility: 'none' } },
      { id: 'basemap-arctic', type: 'raster', source: 'basemap-arctic', layout: { visibility: 'none' } },
      { id: 'basemap-antarctic', type: 'raster', source: 'basemap-antarctic', layout: { visibility: 'none' } },
    ],
  }
}

function transformCoord(lon, lat, projection) {
  if (typeof lon !== 'number' || typeof lat !== 'number') return [lon, lat]

  if (projection === 'arctic') {
    const r = (90 - lat) * 0.18
    const rad = (lon * Math.PI) / 180
    const x = r * Math.sin(rad)
    const y = -r * Math.cos(rad)
    return [x, 80 + y]
  }

  if (projection === 'antarctic') {
    const r = (90 + lat) * 0.18
    const rad = (lon * Math.PI) / 180
    const x = r * Math.sin(rad)
    const y = r * Math.cos(rad)
    return [x, -82 + y]
  }

  return [lon, lat]
}

function transformGeoJSON(geojson, projection) {
  if (!geojson || !geojson.features || projection === 'mercator' || projection === 'wgs84') {
    return geojson
  }
  const transformedFeatures = geojson.features.map(feat => {
    if (!feat.geometry) return feat
    const geom = feat.geometry
    if (geom.type === 'Point') {
      const [tLon, tLat] = transformCoord(geom.coordinates[0], geom.coordinates[1], projection)
      return { ...feat, geometry: { ...geom, coordinates: [tLon, tLat] } }
    }
    if (geom.type === 'Polygon') {
      const rings = geom.coordinates.map(ring =>
        ring.map(([lon, lat]) => transformCoord(lon, lat, projection))
      )
      return { ...feat, geometry: { ...geom, coordinates: rings } }
    }
    if (geom.type === 'LineString') {
      const coords = geom.coordinates.map(([lon, lat]) => transformCoord(lon, lat, projection))
      return { ...feat, geometry: { ...geom, coordinates: coords } }
    }
    return feat
  })
  return { ...geojson, features: transformedFeatures }
}

function createArrowImageData(fillColor, strokeColor = '#ffffff') {
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = fillColor
  ctx.strokeStyle = strokeColor
  ctx.lineWidth = 1.8

  ctx.beginPath()
  ctx.moveTo(16, 2)   // Arrow tip pointing North (0 deg)
  ctx.lineTo(27, 26)  // Right wing
  ctx.lineTo(16, 19)  // Notch
  ctx.lineTo(5, 26)   // Left wing
  ctx.closePath()

  ctx.fill()
  ctx.stroke()

  return ctx.getImageData(0, 0, 32, 32)
}

export default function MapView() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const {
    waypoints, addWaypoint, route, routeLoading,
    basemap, mapProjection, setMapProjection,
    showEca, showChokepoints, showChevrons, showSeaIce, showOceanCurrents, showWind,
    icebergs, sliderTimeISO, departureTimeUTC,
  } = usePlanner()

  const addRef = useRef(addWaypoint)
  addRef.current = addWaypoint
  const wpLenRef = useRef(waypoints.length)
  wpLenRef.current = waypoints.length

  const rawSeaIceRef = useRef(null)
  const rawCurrentsRef = useRef(null)
  const rawWindRef = useRef(null)
  const rawEcasRef = useRef(null)
  const rawChokepointsRef = useRef(null)

  const syncVectorLayers = () => {
    const map = mapRef.current
    if (!map) return

    if (rawSeaIceRef.current && map.getSource('sea-ice')) {
      map.getSource('sea-ice').setData(transformGeoJSON(rawSeaIceRef.current, mapProjection))
    }
    if (rawCurrentsRef.current && map.getSource('ocean-currents')) {
      map.getSource('ocean-currents').setData(transformGeoJSON(rawCurrentsRef.current, mapProjection))
    }
    if (rawWindRef.current && map.getSource('wind')) {
      map.getSource('wind').setData(transformGeoJSON(rawWindRef.current, mapProjection))
    }
    if (rawEcasRef.current && map.getSource('ecas')) {
      map.getSource('ecas').setData(transformGeoJSON(rawEcasRef.current, mapProjection))
    }
    if (rawChokepointsRef.current && map.getSource('chokepoints')) {
      map.getSource('chokepoints').setData(transformGeoJSON(rawChokepointsRef.current, mapProjection))
    }
  }

  const syncRef = useRef(syncVectorLayers)
  syncRef.current = syncVectorLayers

  // Always holds a fn drawing the *current* route into the map source
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

      map.addSource('sea-ice', { type: 'geojson', data: emptyFeatureCollection() })
      map.addLayer({
        id: 'sea-ice-fill',
        type: 'fill',
        source: 'sea-ice',
        paint: {
          'fill-color': [
            'match',
            ['get', 'category'],
            'heavy', '#0077b6',
            'medium', '#00b4d8',
            '#90e0ef'
          ],
          'fill-opacity': 0.35,
        },
      })

      if (!map.hasImage('ocean-current-arrow')) {
        map.addImage('ocean-current-arrow', createArrowImageData('#00b4d8', '#004b6e'))
      }
      if (!map.hasImage('wind-arrow')) {
        map.addImage('wind-arrow', createArrowImageData('#a855f7', '#4c1d95'))
      }

      map.addSource('ocean-currents', { type: 'geojson', data: emptyFeatureCollection() })
      map.addLayer({
        id: 'ocean-currents-vectors',
        type: 'symbol',
        source: 'ocean-currents',
        layout: {
          'icon-image': 'ocean-current-arrow',
          'icon-size': 0.65,
          'icon-rotate': ['get', 'dirDeg'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      })

      map.addSource('wind', { type: 'geojson', data: emptyFeatureCollection() })
      map.addLayer({
        id: 'wind-vectors',
        type: 'symbol',
        source: 'wind',
        layout: {
          'icon-image': 'wind-arrow',
          'icon-size': 0.6,
          'icon-rotate': ['get', 'dirDeg'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
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
      drawRouteRef.current()
      syncRef.current()
    })

    return () => {
      Object.values(icebergMarkersRef.current).forEach(m => m.remove())
      icebergMarkersRef.current = {}
      if (shipMarkerRef.current) {
        shipMarkerRef.current.remove()
        shipMarkerRef.current = null
      }
      map.remove()
      mapRef.current = null
    }
  }, [])

  // ---- route geometry (transformed for current projection) ----
  useEffect(() => {
    drawRouteRef.current = () => {
      const map = mapRef.current
      if (!map || !map.getSource('route')) return
      let geo
      if (!route || !route.legs || !route.legs.length) {
        geo = emptyFeatureCollection()
      } else {
        let pts = []
        for (const leg of route.legs) {
          const legPts = leg.path.map(([lat, lon]) => [lat, lon])
          if (pts.length && samePoint(pts[pts.length - 1], legPts[0])) legPts.shift()
          pts.push(...legPts)
        }
        if (pts.length < 2) {
          geo = emptyFeatureCollection()
        } else {
          const unwrapped = unwrapLongitudes(pts)
          const parts = splitIntoRenderedParts(unwrapped)

          const transformedParts = parts.map(part =>
            part.map(([lon, lat]) => transformCoord(lon, lat, mapProjection))
          )

          geo = transformedParts.length === 1
            ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: transformedParts[0] } }
            : { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: transformedParts } }
        }
      }
      map.getSource('route').setData(geo)
    }
    const map = mapRef.current
    if (map && map.getSource('route')) drawRouteRef.current()
    return () => { drawRouteRef.current = () => {} }
  }, [route, mapProjection])

  // ---- waypoint pins (transformed for current projection) ----
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getSource('waypoints')) return
    const features = waypoints
      .filter(w => typeof w.lat === 'number')
      .map((w, i) => {
        const [tLon, tLat] = transformCoord(w.lon, w.lat, mapProjection)
        return {
          type: 'Feature',
          properties: { rank: String(i + 1), label: w.label },
          geometry: { type: 'Point', coordinates: [tLon, tLat] },
        }
      })
    map.getSource('waypoints').setData({ type: 'FeatureCollection', features })
  }, [waypoints, mapProjection])

  // ---- iceberg DOM markers synced to slider time ----
  const icebergMarkersRef = useRef({})

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (!icebergs || !icebergs.length) {
      Object.values(icebergMarkersRef.current).forEach(m => m.remove())
      icebergMarkersRef.current = {}
      return
    }

    const targetTime = sliderTimeISO || departureTimeUTC
    const currentIds = new Set(icebergs.map(b => b.id))

    Object.keys(icebergMarkersRef.current).forEach(id => {
      if (!currentIds.has(id)) {
        icebergMarkersRef.current[id].remove()
        delete icebergMarkersRef.current[id]
      }
    })

    icebergs.forEach(berg => {
      const pos = getIcebergPositionAtTime(berg, targetTime)
      const [tLon, tLat] = transformCoord(pos.lon, pos.lat, mapProjection)
      const heading = typeof pos.headingDeg === 'number' ? pos.headingDeg : (berg.headingDeg || 0)
      const speed = typeof pos.speedKnots === 'number' ? pos.speedKnots : (berg.speedKnots || 0.5)

      if (icebergMarkersRef.current[berg.id]) {
        icebergMarkersRef.current[berg.id].setLngLat([tLon, tLat])
        const arrowEl = icebergMarkersRef.current[berg.id].getElement().querySelector('.iceberg-drift-arrow')
        if (arrowEl) arrowEl.style.transform = `rotate(${heading}deg)`
      } else {
        const el = document.createElement('div')
        el.className = 'iceberg-marker-el'
        el.innerHTML = `
          <div class="iceberg-marker-wrap">
            <div class="iceberg-drift-arrow" style="transform: rotate(${heading}deg);" title="Drift Heading: ${heading}°, Speed: ${speed} kn">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L18 10H14V22H10V10H6L12 2Z" fill="#ff7a00" stroke="#8c3e00" stroke-width="1.5" stroke-linejoin="round"/>
              </svg>
            </div>
            <div class="iceberg-svg-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <polygon points="12,2 22,21 2,21" fill="#00d2ff" stroke="#005b96" stroke-width="2" stroke-linejoin="round"/>
                <polygon points="12,2 15,10 12,14 8,11" fill="#ffffff" opacity="0.65"/>
              </svg>
            </div>
          </div>
          <div class="iceberg-label">${berg.name || berg.id} (${speed} kn ➔ ${Math.round(heading)}°)</div>
        `
        const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([tLon, tLat])
          .addTo(map)
        icebergMarkersRef.current[berg.id] = marker
      }
    })
  }, [icebergs, sliderTimeISO, departureTimeUTC, mapProjection])

  // ---- moving ship DOM marker synced to slider time ----
  const shipMarkerRef = useRef(null)

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (!route || !sliderTimeISO) {
      if (shipMarkerRef.current) {
        shipMarkerRef.current.remove()
        shipMarkerRef.current = null
      }
      return
    }

    const shipPos = getShipPositionAtTime(route, departureTimeUTC, sliderTimeISO)
    if (!shipPos) {
      if (shipMarkerRef.current) {
        shipMarkerRef.current.remove()
        shipMarkerRef.current = null
      }
      return
    }

    const [tLon, tLat] = transformCoord(shipPos.lon, shipPos.lat, mapProjection)

    if (shipMarkerRef.current) {
      shipMarkerRef.current.setLngLat([tLon, tLat])
    } else {
      const el = document.createElement('div')
      el.className = 'ship-marker-el'
      el.innerHTML = `
        <div class="ship-pulse-halo"></div>
        <div class="ship-svg-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 15L2 9H22L20 15H4Z" fill="#ff7a00" stroke="#b35400" stroke-width="1.5" stroke-linejoin="round"/>
            <path d="M7 9V5H12V9" fill="#ffffff" stroke="#b35400" stroke-width="1.5" stroke-linejoin="round"/>
            <path d="M14 9V6H17V9" fill="#ffffff" stroke="#b35400" stroke-width="1.5" stroke-linejoin="round"/>
            <path d="M2 18C5 18 7 16 10 18C13 20 15 18 18 18C20 18 22 17 23 16.5" stroke="#ff7a00" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
      `
      shipMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([tLon, tLat])
        .addTo(map)
    }
  }, [route, sliderTimeISO, departureTimeUTC, mapProjection])

  // ---- ECA + chokepoints + sea-ice + currents + wind data ----
  useEffect(() => {
    let alive = true
    fetchEcas().then(fc => {
      if (!alive) return
      rawEcasRef.current = fc
      syncRef.current()
    }).catch(() => {})

    fetchChokepoints().then(fc => {
      if (!alive) return
      rawChokepointsRef.current = fc
      syncRef.current()
    }).catch(() => {})

    fetchSeaIce().then(fc => {
      if (!alive) return
      rawSeaIceRef.current = fc
      syncRef.current()
    }).catch(() => {})

    fetchOceanCurrents().then(fc => {
      if (!alive) return
      rawCurrentsRef.current = fc
      syncRef.current()
    }).catch(() => {})

    fetchWind().then(fc => {
      if (!alive) return
      rawWindRef.current = fc
      syncRef.current()
    }).catch(() => {})

    return () => { alive = false }
  }, [])

  useEffect(() => {
    syncVectorLayers()
  }, [mapProjection, syncVectorLayers])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('sea-ice-fill')) return
    map.setLayoutProperty('sea-ice-fill', 'visibility', showSeaIce ? 'visible' : 'none')
  }, [showSeaIce])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('ocean-currents-vectors')) return
    map.setLayoutProperty('ocean-currents-vectors', 'visibility', showOceanCurrents ? 'visible' : 'none')
  }, [showOceanCurrents])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('wind-vectors')) return
    map.setLayoutProperty('wind-vectors', 'visibility', showWind ? 'visible' : 'none')
  }, [showWind])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('eca-outline')) return
    const isPolar = mapProjection === 'arctic' || mapProjection === 'antarctic'
    map.setLayoutProperty('eca-fill', 'visibility', showEca && !isPolar ? 'visible' : 'none')
    map.setLayoutProperty('eca-outline', 'visibility', showEca && !isPolar ? 'visible' : 'none')
  }, [showEca, mapProjection])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('chokepoints')) return
    const isPolar = mapProjection === 'arctic' || mapProjection === 'antarctic'
    map.setLayoutProperty('chokepoints', 'visibility', showChokepoints && !isPolar ? 'visible' : 'none')
  }, [showChokepoints, mapProjection])

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

    if (mapProjection === 'arctic') {
      map.setLayoutProperty('basemap-standard', 'visibility', 'none')
      map.setLayoutProperty('basemap-light', 'visibility', 'none')
      map.setLayoutProperty('basemap-ocean', 'visibility', 'none')
      map.setLayoutProperty('basemap-antarctic', 'visibility', 'none')
      map.setLayoutProperty('basemap-arctic', 'visibility', 'visible')
    } else if (mapProjection === 'antarctic') {
      map.setLayoutProperty('basemap-standard', 'visibility', 'none')
      map.setLayoutProperty('basemap-light', 'visibility', 'none')
      map.setLayoutProperty('basemap-ocean', 'visibility', 'none')
      map.setLayoutProperty('basemap-arctic', 'visibility', 'none')
      map.setLayoutProperty('basemap-antarctic', 'visibility', 'visible')
    } else if (mapProjection === 'wgs84') {
      map.setLayoutProperty('basemap-standard', 'visibility', 'none')
      map.setLayoutProperty('basemap-light', 'visibility', 'none')
      map.setLayoutProperty('basemap-arctic', 'visibility', 'none')
      map.setLayoutProperty('basemap-antarctic', 'visibility', 'none')
      map.setLayoutProperty('basemap-ocean', 'visibility', 'visible')
    } else {
      const target = `basemap-${basemap}`
      map.setLayoutProperty('basemap-standard', 'visibility', target === 'basemap-standard' ? 'visible' : 'none')
      map.setLayoutProperty('basemap-light', 'visibility', target === 'basemap-light' ? 'visible' : 'none')
      map.setLayoutProperty('basemap-ocean', 'visibility', 'none')
      map.setLayoutProperty('basemap-arctic', 'visibility', 'none')
      map.setLayoutProperty('basemap-antarctic', 'visibility', 'none')
    }
  }, [basemap, mapProjection])

  // ---- projection & polar view switcher ----
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    try {
      if (mapProjection === 'wgs84') {
        map.flyTo({ center: [0, 15], zoom: 1.6, pitch: 0, duration: 1000 })
      } else if (mapProjection === 'arctic') {
        map.flyTo({ center: [0, 80], zoom: 1.5, pitch: 0, duration: 1000 })
      } else if (mapProjection === 'antarctic') {
        map.flyTo({ center: [0, -82], zoom: 1.4, pitch: 0, duration: 1000 })
      } else {
        // mercator
        map.flyTo({ center: [66, 12], zoom: 2.4, pitch: 0, duration: 1000 })
      }
    } catch {
      /* ignore */
    }
  }, [mapProjection])

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
      
      <LayerControlPanel />

      <div className="map-projection-bar">
        {[
          ['mercator', 'Mercator'],
          ['wgs84', 'WGS84'],
          ['arctic', 'Arctic'],
          ['antarctic', 'Antarctic'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`map-proj-btn ${mapProjection === key ? 'active' : ''}`}
            onClick={() => setMapProjection(key)}
          >
            {label}
          </button>
        ))}
      </div>

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