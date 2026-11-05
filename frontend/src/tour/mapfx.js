/**
 * Map-native effects for the tour.
 *
 * These run against the real MapLibre instance rather than over the top of it,
 * so the route genuinely draws itself along its own geometry rather than
 * being a faked overlay that would drift out of register the moment the map
 * moved.
 */

const ROUTE_BLUE = '#1452c4'
const TRANSPARENT = 'rgba(20, 82, 196, 0)'

/**
 * Draws the route on from origin to destination.
 *
 * Uses `line-progress`, which needs `lineMetrics: true` on the route source —
 * MapView sets it. The outline layer is faded out for the duration, otherwise
 * it would sit there showing the finished route and give the ending away.
 */
export function drawRouteOn(map, duration = 1500) {
  if (!map || !map.getLayer('route-line')) return () => {}

  let raf = 0
  let cancelled = false

  const finish = () => {
    if (!map.getLayer('route-line')) return
    map.setPaintProperty('route-line', 'line-gradient', null)
    if (map.getLayer('route-outline')) map.setPaintProperty('route-outline', 'line-opacity', 1)
  }

  if (map.getLayer('route-outline')) map.setPaintProperty('route-outline', 'line-opacity', 0)

  const started = performance.now()
  const tick = () => {
    if (cancelled || !map.getLayer('route-line')) return
    const p = Math.min(1, (performance.now() - started) / duration)
    // Ease-out so the head slows as it lands on the destination.
    const eased = 1 - Math.pow(1 - p, 3)
    // Gradient stops must be strictly ascending and inside (0, 1).
    const head = Math.min(0.999, Math.max(0.002, eased))

    map.setPaintProperty('route-line', 'line-gradient', [
      'interpolate', ['linear'], ['line-progress'],
      0, ROUTE_BLUE,
      head - 0.001, ROUTE_BLUE,
      head, TRANSPARENT,
      1, TRANSPARENT,
    ])

    if (p < 1) raf = requestAnimationFrame(tick)
    else finish()
  }
  raf = requestAnimationFrame(tick)

  return () => { cancelled = true; cancelAnimationFrame(raf); finish() }
}
