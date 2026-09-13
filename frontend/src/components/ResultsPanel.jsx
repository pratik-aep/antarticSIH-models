import React from 'react'
import { MapPin, Ship, Navigation } from 'lucide-react'
import { fmtHours } from '../utils'

function Row({ label, value, sub, icon }) {
  return (
    <div className="res-row">
      <span className="res-icon">{icon}</span>
      <span className="res-label">{label}</span>
      <span className="res-value">
        {value}
        {sub ? <em>{sub}</em> : null}
      </span>
    </div>
  )
}

export default function ResultsPanel({ route, loading, error, waypoints }) {
  if (error) {
    return (
      <div className="results results-error">
        <div className="res-title">Route</div>
        <p className="error-msg">{error}</p>
      </div>
    )
  }

  if (loading && !route) {
    return (
      <div className="results results-loading">
        <div className="res-title">Route</div>
        <div className="skeleton-line" />
        <div className="skeleton-line short" />
        <div className="skeleton-line" />
        <div className="skeleton-line short" />
      </div>
    )
  }

  if (!route) return null

  const places = route.legs.map(l => l.from.label)
  places.push(route.legs[route.legs.length - 1].to.label)

  return (
    <div className="results">
      <div className="res-title">Route</div>

      <div className="res-route-stops">
        {places.map((p, i) => (
          <div key={i} className={`res-stop ${i === 0 ? 'origin' : i === places.length - 1 ? 'dest' : ''}`}>
            <div className="res-stop-badge">
              <span className="res-stop-num">{i + 1}</span>
              {i < places.length - 1 && <span className="res-stop-line" />}
            </div>
            <span className="res-stop-name">{p}</span>
          </div>
        ))}
      </div>

      <Row icon={<Ship size={15} />} label="Distance" value={`${route.totalDistanceNm.toLocaleString()} nm`} sub="total geodesic" />
      <Row icon={<MapPin size={15} />} label="Distance in ECA" value={route.totalDistanceInEcaNm ? `${route.totalDistanceInEcaNm.toLocaleString()} nm` : '0 nm'} sub={route.totalDistanceInEcaNm ? 'Emission control areas' : undefined} />
      <Row icon={<Navigation size={15} />} label="Duration" value={fmtHours(route.totalDurationHours)} />
      <div className="res-row">
        <span className="res-icon">🕒</span>
        <span className="res-label">Estimated arrival (UTC)</span>
        <span className="res-value">{new Date(route.etaUTC).toLocaleString('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' })} UTC</span>
      </div>

      <div className="res-row crossing-row">
        <span className="res-icon">⛵</span>
        <span className="res-label">Crossing</span>
        <span className="res-value crossing-value">
          {route.crossings && route.crossings.length ? (
            route.crossings.map(c => <span key={c} className="crossing-chip">{c}</span>)
          ) : (
            <em className="none">— no named crossings —</em>
          )}
        </span>
      </div>

      <div className="res-per-leg">
        {route.legs.map((leg, i) => (
          <div key={i} className="res-leg">
            <span className="res-leg-names">{leg.from.label} → {leg.to.label}</span>
            <span className="res-leg-meta">
              {leg.distanceNm.toLocaleString()} nm · {fmtHours(leg.durationHours)}
              {leg.crossings.length ? ` · ${leg.crossings.join(', ')}` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}