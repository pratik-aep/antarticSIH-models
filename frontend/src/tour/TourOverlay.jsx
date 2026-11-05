import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePlanner } from '../store'
import { createContext, runTour, sceneTimings, totalDuration } from './engine'
import { resetForTour, storyboard, STAT_CARDS } from './storyboard'
import './tour.css'

const TOTAL_MS = totalDuration(storyboard)
const TIMINGS = sceneTimings(storyboard)

/** Splits text into mask-revealed words that rise in sequence. */
function Kinetic({ text, lead = 0 }) {
  const words = String(text).split(' ')
  return words.map((word, i) => (
    <React.Fragment key={`${word}-${i}`}>
      <span className="tour-word-mask">
        <span className="tour-word" style={{ '--i': i, '--lead': `${lead}ms` }}>{word}</span>
      </span>
      {i < words.length - 1 ? ' ' : null}
    </React.Fragment>
  ))
}

/**
 * Counts a figure up from zero.
 *
 * The numbers are read live off the computed route, so the card shows what the
 * engine actually returned — the animation is the only thing invented here.
 */
function useCountUp(target, { duration = 1100, delay = 0, active }) {
  const [value, setValue] = useState(0)

  useEffect(() => {
    if (!active || !Number.isFinite(target)) { setValue(0); return }
    let raf = 0
    let startedAt = 0
    const tick = (now) => {
      if (!startedAt) startedAt = now
      const t = (now - startedAt - delay) / duration
      if (t < 0) { raf = requestAnimationFrame(tick); return }
      const p = Math.min(1, t)
      // Ease-out cubic: fast off the mark, settles onto the final figure.
      setValue(target * (1 - Math.pow(1 - p, 3)))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration, delay, active])

  return value
}

function StatCard({ card, route, planner, index }) {
  const target = route ? Number(card.get(route, planner)) : NaN
  const value = useCountUp(target, { delay: index * 110 + 120, active: !!route })
  const text = Number.isFinite(target)
    ? value.toLocaleString(undefined, {
        minimumFractionDigits: card.decimals,
        maximumFractionDigits: card.decimals,
      })
    : '—'

  return (
    <div className="tour-stat" style={{ '--i': index }}>
      <span className="tour-stat-value">{text}</span>
      <span className="tour-stat-label">{card.label}</span>
    </div>
  )
}

/**
 * Scripted demo tour: title cards, kinetic lower thirds, live stat cards,
 * spotlights and a real MapLibre camera, driven off `storyboard.js`.
 *
 * Start it with the T key, the launcher button, or `?tour=1` in the URL
 * (which also auto-starts after a settle delay so a screen recording can be
 * rolling before the first frame). Esc stops.
 */
export default function TourOverlay() {
  const planner = usePlanner()

  // Scenes must see the newest store setters, not the ones captured when the
  // tour started, so reads are proxied through a ref rather than closed over.
  const plannerRef = useRef(planner)
  plannerRef.current = planner
  const plannerProxy = useMemo(
    () => new Proxy({}, { get: (_t, key) => plannerRef.current[key] }),
    [],
  )

  const [playing, setPlaying] = useState(false)
  const [scene, setScene] = useState(null)
  const [spotlight, setSpotlight] = useState(null)
  const [spotRect, setSpotRect] = useState(null)
  const [chromeVisible, setChromeVisible] = useState(true)
  const [elapsed, setElapsed] = useState(0)

  const abortRef = useRef(null)

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setPlaying(false)
    setScene(null)
    setSpotlight(null)
    setChromeVisible(true)
    setElapsed(0)
  }, [])

  const start = useCallback(async () => {
    if (abortRef.current) return
    const controller = new AbortController()
    abortRef.current = controller

    resetForTour(plannerRef.current)
    setPlaying(true)
    setElapsed(0)

    const ctx = createContext({
      planner: plannerProxy,
      signal: controller.signal,
      setSpotlight,
      setChrome: setChromeVisible,
    })

    try {
      await runTour(storyboard, ctx, { onScene: setScene })
    } finally {
      if (abortRef.current === controller) stop()
    }
  }, [plannerProxy, stop])

  // ---- controls: T to start, Esc to stop ----
  useEffect(() => {
    function onKey(e) {
      if (e.target instanceof HTMLElement &&
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
      if (e.key === 'Escape') stop()
      else if (e.key === 't' || e.key === 'T') playing ? stop() : start()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playing, start, stop])

  // ---- ?tour=1 auto-start, after a settle delay for tiles to land ----
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('tour') !== '1') return
    const delay = Number(params.get('delay') ?? 2500)
    const timer = setTimeout(() => start(), Number.isFinite(delay) ? delay : 2500)
    return () => clearTimeout(timer)
    // Intentionally mount-only: a re-run would restart the tour mid-take.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- body class drives the chrome fade (panels live outside this tree) ----
  useEffect(() => {
    document.body.classList.toggle('tour-chrome-hidden', playing && !chromeVisible)
    document.body.classList.toggle('tour-playing', playing)
    return () => {
      document.body.classList.remove('tour-chrome-hidden', 'tour-playing')
    }
  }, [playing, chromeVisible])

  // ---- progress clock ----
  useEffect(() => {
    if (!playing) return
    const startedAt = performance.now()
    let raf = 0
    const tick = () => {
      setElapsed(performance.now() - startedAt)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  // ---- spotlight tracking ----
  // Panel content reflows while the tour runs (the results block appears, the
  // HUD grows), so the rect is re-measured on a short interval instead of once.
  useEffect(() => {
    if (!spotlight) { setSpotRect(null); return }
    const measure = () => {
      const el = document.querySelector(spotlight.selector)
      if (!el) { setSpotRect(null); return }
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) { setSpotRect(null); return }
      setSpotRect({ top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 })
    }
    measure()
    const id = setInterval(measure, 250)
    window.addEventListener('resize', measure)
    return () => { clearInterval(id); window.removeEventListener('resize', measure) }
  }, [spotlight])

  const isTitle = scene?.kind === 'title'
  const sceneDur = scene ? `${scene.dur}ms` : undefined
  const bars = playing && !!scene?.letterbox

  return (
    <div className="tour-root">
      <div className={`tour-vignette ${playing && isTitle ? 'on' : ''}`} />
      <div className={`tour-bar top ${bars ? 'on' : ''}`} />
      <div className={`tour-bar bottom ${bars ? 'on' : ''}`} />

      {scene && isTitle && (
        // Keying by scene id remounts the node, which replays the keyframes.
        <div key={scene.id} className="tour-title-card" style={{ '--scene-dur': sceneDur }}>
          <h1 className="tour-title"><Kinetic text={scene.title} lead={120} /></h1>
          <div className="tour-title-rule" style={{ '--scene-dur': sceneDur }} />
          <p className="tour-subtitle"><Kinetic text={scene.subtitle} lead={420} /></p>
        </div>
      )}

      {scene && !isTitle && (
        <div key={scene.id} className="tour-lower-third" style={{ '--scene-dur': sceneDur }}>
          {scene.kicker && <span className="tour-kicker">{scene.kicker}</span>}
          <p className="tour-caption"><Kinetic text={scene.caption} lead={180} /></p>
        </div>
      )}

      {scene?.stats && (
        <div key={`${scene.id}-stats`} className="tour-stats" style={{ '--scene-dur': sceneDur }}>
          {STAT_CARDS.map((card, i) => (
            <StatCard key={card.key} card={card} route={planner.route} planner={planner} index={i} />
          ))}
        </div>
      )}

      {spotRect && (
        <div className="tour-spotlight" style={spotRect}>
          {spotlight?.label && <span className="tour-spot-label">{spotlight.label}</span>}
        </div>
      )}

      {playing && (
        <div className="tour-progress">
          {TIMINGS.map((t) => {
            const fill = Math.min(1, Math.max(0, (elapsed - t.startMs) / t.durMs))
            return (
              <div key={t.id} className="tour-progress-seg" style={{ '--w': t.durMs / TOTAL_MS }}>
                <i style={{ transform: `scaleX(${fill})` }} />
              </div>
            )
          })}
        </div>
      )}

      {!playing && (
        <button className="tour-launcher" onClick={start} title="Play the scripted demo tour">
          ▶ Play demo tour <kbd>T</kbd>
        </button>
      )}
    </div>
  )
}
