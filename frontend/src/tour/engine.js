/**
 * Tour playback engine.
 *
 * Timing is strictly wall-clock: every scene occupies exactly its declared
 * `dur`, and a scene's `run()` is fired but never awaited past that window.
 * That matters because the voiceover is cut against these timings — if a slow
 * tile fetch could stretch a scene, the narration would drift out of sync by
 * the end of the take. Camera moves are started and left to run on MapLibre's
 * own easing clock for the same reason.
 */

import { getMap, whenMapReady } from './mapBus'
import { drawRouteOn } from './mapfx'

export class TourAborted extends Error {
  constructor() {
    super('tour aborted')
    this.name = 'TourAborted'
  }
}

export function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new TourAborted())
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => { clearTimeout(timer); reject(new TourAborted()) },
      { once: true },
    )
  })
}

/** Cumulative start time of each scene — used to cut the voiceover. */
export function sceneTimings(storyboard) {
  let t = 0
  return storyboard.map((scene) => {
    const row = { id: scene.id, startMs: t, durMs: scene.dur, endMs: t + scene.dur }
    t += scene.dur
    return row
  })
}

export function totalDuration(storyboard) {
  return storyboard.reduce((sum, s) => sum + s.dur, 0)
}

/**
 * Builds the context handed to every scene's `run()`.
 * `planner` is the live store value, so scenes drive the real app state
 * rather than a mock — the route that draws is the routing engine's answer.
 */
export function createContext({ planner, signal, setSpotlight, setChrome }) {
  const sleep = (ms) => wait(ms, signal)

  /** Start a camera move and return immediately. */
  function fly(opts) {
    const map = getMap()
    if (!map) return
    const { duration = 2000, ...rest } = opts
    map.flyTo({ duration, essential: true, ...rest })
  }

  /** Start a camera move and hold for its duration. */
  async function flyFor(opts) {
    fly(opts)
    await sleep(opts.duration ?? 2000)
  }

  function jump(opts) {
    const map = getMap()
    if (map) map.jumpTo(opts)
  }

  /** Animates the route drawing itself along its own geometry. */
  function drawRoute(duration) {
    drawRouteOn(getMap(), duration)
  }

  return {
    planner,
    signal,
    sleep,
    fly,
    flyFor,
    jump,
    drawRoute,
    getMap,
    whenMapReady,
    spotlight: setSpotlight,
    clearSpotlight: () => setSpotlight(null),
    chrome: setChrome,
  }
}

/**
 * Plays the storyboard start to finish.
 * Resolves normally when finished, or when aborted mid-scene.
 */
export async function runTour(storyboard, ctx, { onScene } = {}) {
  const { signal } = ctx
  try {
    await whenMapReady()
    for (let i = 0; i < storyboard.length; i++) {
      if (signal?.aborted) throw new TourAborted()
      const scene = storyboard[i]
      onScene?.(scene, i)

      // Fired, not awaited: a scene that overruns must not push the timeline.
      Promise.resolve()
        .then(() => scene.run?.(ctx))
        .catch((err) => {
          if (!(err instanceof TourAborted)) {
            console.warn(`[tour] scene "${scene.id}" failed:`, err)
          }
        })

      await wait(scene.dur, signal)
    }
    onScene?.(null, storyboard.length)
  } catch (err) {
    if (!(err instanceof TourAborted)) throw err
  }
}
