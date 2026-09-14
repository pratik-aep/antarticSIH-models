import React, { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react'
import { computeRoute, fetchIcebergs } from './api'
import { computeClosestApproaches } from './utils'

const PlannerContext = createContext(null)

export function usePlanner() {
  return useContext(PlannerContext)
}

export function defaultDeparture() {
  const d = new Date()
  d.setSeconds(0, 0)
  return d.toISOString().slice(0, 16).replace('T', 'T')
}

export function makeWaypoint(overrides = {}) {
  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
    label: '',
    countryCode: '',
    lat: null,
    lon: null,
    isPort: true,
    ...overrides,
  }
}

export function validWaypoints(wps) {
  return wps.every(w => typeof w.lat === 'number' && typeof w.lon === 'number')
}

export function PlannerProvider({ children }) {
  const [waypoints, setWaypoints] = useState(() => [makeWaypoint({}), makeWaypoint({})])
  const [speedKnots, setSpeedKnots] = useState(15)
  const [departureTimeUTC, setDepartureTimeUTC] = useState(defaultDeparture())
  const [optimizeFor, setOptimizeFor] = useState('distance')
  const [vesselType, setVesselType] = useState('cargo')
  const [draftMeters, setDraftMeters] = useState(10.5)
  const [iceClass, setIceClass] = useState('none')
  const [mapProjection, setMapProjection] = useState('mercator')

  const [basemap, setBasemap] = useState('standard')
  const [showEca, setShowEca] = useState(true)
  const [showChokepoints, setShowChokepoints] = useState(false)
  const [showChevrons, setShowChevrons] = useState(true)

  const [route, setRoute] = useState(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeError, setRouteError] = useState(null)

  const [icebergs, setIcebergs] = useState([])
  const [sliderTimeISO, setSliderTimeISO] = useState('')
  const [isPlaying, setIsPlaying] = useState(false)

  const setWaypoint = useCallback((index, patch) => {
    setWaypoints(prev => prev.map((w, i) => (i === index ? { ...w, ...patch } : w)))
  }, [])

  const addWaypoint = useCallback((patch = {}) => {
    setWaypoints(prev => [...prev, makeWaypoint(patch)])
  }, [])

  const removeWaypoint = useCallback((index) => {
    setWaypoints(prev => {
      if (prev.length <= 2) {
        const w = prev[index]
        if (w && typeof w.lat === 'number') {
          return prev.map((p, i) =>
            i === index ? { ...p, label: '', countryCode: '', lat: null, lon: null, isPort: true } : p)
        }
        return prev
      }
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  const moveWaypoint = useCallback((from, to) => {
    setWaypoints(prev => {
      if (from === to || from < 0 || to < 0 || to >= prev.length) return prev
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }, [])

  const valid = validWaypoints(waypoints)

  useEffect(() => {
    if (!valid) {
      setRoute(null)
      setRouteError(null)
      setIcebergs([])
      return
    }

    let active = true
    let timer = null

    const run = async () => {
      setRouteLoading(true)
      setRouteError(null)
      try {
        const payload = {
          waypoints: waypoints.map(w => ({ id: w.id, label: w.label, countryCode: w.countryCode, lat: w.lat, lon: w.lon, isPort: w.isPort })),
          speedKnots,
          departureTimeUTC,
          optimizeFor,
          vesselType,
          draftMeters,
          iceClass,
        }
        const res = await computeRoute(
          payload.waypoints,
          payload.speedKnots,
          payload.departureTimeUTC,
          payload.optimizeFor,
          payload.vesselType,
          payload.draftMeters,
          payload.iceClass,
        )
        if (active) {
          setRoute(res)
          setRouteLoading(false)
          setSliderTimeISO(departureTimeUTC)

          // Fetch iceberg trajectories covering the route window
          try {
            const bergs = await fetchIcebergs(departureTimeUTC, res.etaUTC, 1.0)
            if (active) setIcebergs(bergs)
          } catch {
            if (active) setIcebergs([])
          }
        }
      } catch (err) {
        if (active) {
          setRoute(null)
          setRouteError(err instanceof Error ? err.message : 'Routing failed')
          setRouteLoading(false)
          setIcebergs([])
        }
      }
    }

    timer = setTimeout(run, 350)
    return () => { active = false; clearTimeout(timer) }
  }, [waypoints, speedKnots, departureTimeUTC, optimizeFor, vesselType, draftMeters, iceClass, valid])

  const closestApproaches = useMemo(() => {
    if (!route || !icebergs.length) return []
    return computeClosestApproaches(route, departureTimeUTC, icebergs)
  }, [route, departureTimeUTC, icebergs])

  const value = useMemo(() => ({
    waypoints, setWaypoint, addWaypoint, removeWaypoint, moveWaypoint,
    speedKnots, setSpeedKnots,
    departureTimeUTC, setDepartureTimeUTC,
    optimizeFor, setOptimizeFor,
    vesselType, setVesselType,
    draftMeters, setDraftMeters,
    iceClass, setIceClass,
    mapProjection, setMapProjection,
    basemap, setBasemap,
    showEca, setShowEca,
    showChokepoints, setShowChokepoints,
    showChevrons, setShowChevrons,
    route, routeLoading, routeError,
    icebergs,
    sliderTimeISO, setSliderTimeISO,
    isPlaying, setIsPlaying,
    closestApproaches,
    valid,
  }), [waypoints, setWaypoint, addWaypoint, removeWaypoint, moveWaypoint, speedKnots,
       departureTimeUTC, optimizeFor, vesselType, draftMeters, iceClass, mapProjection,
       basemap, showEca, showChokepoints, showChevrons,
       route, routeLoading, routeError, icebergs, sliderTimeISO, isPlaying, closestApproaches, valid])

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>
}