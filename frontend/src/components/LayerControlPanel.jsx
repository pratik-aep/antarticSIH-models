import React, { useState } from 'react'
import { Layers, Waves, Wind, Compass, ShieldAlert, Navigation, ChevronRight, Eye, EyeOff } from 'lucide-react'
import { usePlanner } from '../store'

export default function LayerControlPanel() {
  const [isOpen, setIsOpen] = useState(true)
  const {
    showSeaIce, setShowSeaIce,
    showOceanCurrents, setShowOceanCurrents,
    showWind, setShowWind,
    showEca, setShowEca,
    showChokepoints, setShowChokepoints,
    showChevrons, setShowChevrons,
  } = usePlanner()

  const activeCount = [
    showSeaIce, showOceanCurrents, showWind,
    showEca, showChokepoints, showChevrons
  ].filter(Boolean).length

  return (
    <div className={`right-layer-bar ${isOpen ? 'open' : 'collapsed'}`}>
      <button
        type="button"
        className="layer-toggle-btn"
        onClick={() => setIsOpen(!isOpen)}
        title={isOpen ? 'Hide Map Data Layers' : 'Show Map Data Layers'}
      >
        <Layers size={18} />
        <span className="layer-btn-text">Layers</span>
        <span className="layer-badge">{activeCount}</span>
        <ChevronRight size={14} className={`chevron-icon ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <div className="layer-panel-content">
          <div className="layer-panel-header">
            <span className="lp-title">Map Data Selection</span>
            <div className="lp-quick-actions">
              <button
                type="button"
                className="lp-quick-btn"
                onClick={() => {
                  setShowSeaIce(true)
                  setShowOceanCurrents(true)
                  setShowWind(true)
                  setShowEca(true)
                  setShowChokepoints(true)
                  setShowChevrons(true)
                }}
              >
                All
              </button>
              <button
                type="button"
                className="lp-quick-btn"
                onClick={() => {
                  setShowSeaIce(false)
                  setShowOceanCurrents(false)
                  setShowWind(false)
                  setShowEca(false)
                  setShowChokepoints(false)
                  setShowChevrons(false)
                }}
              >
                None
              </button>
            </div>
          </div>

          <div className="layer-list">
            <label className="layer-item">
              <span className="layer-item-icon currents"><Waves size={15} /></span>
              <span className="layer-item-info">
                <span className="layer-name">Ocean Currents</span>
                <span className="layer-sub">Copernicus flow vectors (u, v)</span>
              </span>
              <input
                type="checkbox"
                checked={showOceanCurrents}
                onChange={(e) => setShowOceanCurrents(e.target.checked)}
              />
            </label>

            <label className="layer-item">
              <span className="layer-item-icon wind"><Wind size={15} /></span>
              <span className="layer-item-info">
                <span className="layer-name">Surface Wind</span>
                <span className="layer-sub">ERA5 wind vectors (10m)</span>
              </span>
              <input
                type="checkbox"
                checked={showWind}
                onChange={(e) => setShowWind(e.target.checked)}
              />
            </label>

            <label className="layer-item">
              <span className="layer-item-icon ice"><Compass size={15} /></span>
              <span className="layer-item-info">
                <span className="layer-name">Sea Ice Field</span>
                <span className="layer-sub">AMSR2 0–100% concentration</span>
              </span>
              <input
                type="checkbox"
                checked={showSeaIce}
                onChange={(e) => setShowSeaIce(e.target.checked)}
              />
            </label>

            <label className="layer-item">
              <span className="layer-item-icon eca"><ShieldAlert size={15} /></span>
              <span className="layer-item-info">
                <span className="layer-name">ECA Zones</span>
                <span className="layer-sub">Emission Control Areas</span>
              </span>
              <input
                type="checkbox"
                checked={showEca}
                onChange={(e) => setShowEca(e.target.checked)}
              />
            </label>

            <label className="layer-item">
              <span className="layer-item-icon chokepoint"><Navigation size={15} /></span>
              <span className="layer-item-info">
                <span className="layer-name">Chokepoints</span>
                <span className="layer-sub">Straits, canals & capes</span>
              </span>
              <input
                type="checkbox"
                checked={showChokepoints}
                onChange={(e) => setShowChokepoints(e.target.checked)}
              />
            </label>

            <label className="layer-item">
              <span className="layer-item-icon chevrons">➢</span>
              <span className="layer-item-info">
                <span className="layer-name">Route Chevrons</span>
                <span className="layer-sub">Directional route markers</span>
              </span>
              <input
                type="checkbox"
                checked={showChevrons}
                onChange={(e) => setShowChevrons(e.target.checked)}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  )
}
