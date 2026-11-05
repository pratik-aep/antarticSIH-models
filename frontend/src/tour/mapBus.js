/**
 * MapView builds its MapLibre instance imperatively and parks it in a ref, so
 * nothing outside that component can reach the camera. The tour needs the
 * camera — its zooms are real flyTo moves, not a post-production pixel zoom —
 * so MapView publishes the instance here on load and the tour picks it up.
 *
 * Kept deliberately tiny and framework-free: no React, no store, no imports.
 */

let mapInstance = null
const waiters = []

export function registerMap(map) {
  mapInstance = map
  while (waiters.length) waiters.shift()(map)
}

export function unregisterMap() {
  mapInstance = null
}

export function getMap() {
  return mapInstance
}

/** Resolves once the map exists. The tour can be started before `load` fires. */
export function whenMapReady() {
  if (mapInstance) return Promise.resolve(mapInstance)
  return new Promise((resolve) => waiters.push(resolve))
}
