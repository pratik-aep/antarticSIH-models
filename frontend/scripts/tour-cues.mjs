/**
 * Prints the tour's cue sheet: the exact in/out timecode of every scene.
 *
 * The voiceover is cut against these numbers, so regenerate this after any
 * change to a scene's `dur` — otherwise the narration drifts against the
 * picture. Also sanity-checks that each scene's scripted beats fit inside the
 * screen time it was given.
 *
 *   npm run tour:cues
 */

import { storyboard } from '../src/tour/storyboard.js'

const tc = (ms) => {
  const total = Math.round(ms / 100) / 10
  const m = Math.floor(total / 60)
  const s = (total - m * 60).toFixed(1).padStart(4, '0')
  return `${m}:${s}`
}

let t = 0
const rows = storyboard.map((scene) => {
  const row = { scene, start: t, end: t + scene.dur }
  t += scene.dur
  return row
})

console.log(`\nTour cue sheet — ${rows.length} scenes, total ${tc(t)} (${(t / 1000).toFixed(1)}s)\n`)
console.log('  IN      OUT     DUR   SCENE           TEXT')
console.log('  ' + '-'.repeat(88))

for (const { scene, start, end } of rows) {
  const text = scene.kind === 'title'
    ? `${scene.title} / ${scene.subtitle}`
    : `${scene.kicker} · ${scene.caption}`
  console.log(
    `  ${tc(start).padEnd(7)} ${tc(end).padEnd(7)} ${(scene.dur / 1000).toFixed(0).padStart(2)}s   ` +
    `${scene.id.padEnd(14)}  ${text}`,
  )
}

console.log('')

// Each scene's `run` is fired but never awaited past its `dur` (see engine.js),
// so scripted beats that overrun are silently truncated. Catch that here.
const overruns = []
for (const { scene } of rows) {
  const src = scene.run ? scene.run.toString() : ''
  const beats = [...src.matchAll(/sleep\((\d+)\)/g)].map((m) => Number(m[1]))
  const scripted = beats.reduce((a, b) => a + b, 0)
  if (scripted > scene.dur) overruns.push({ id: scene.id, scripted, dur: scene.dur })
}

if (overruns.length) {
  console.error('Scenes whose scripted beats overrun their screen time:')
  for (const o of overruns) {
    console.error(`  ${o.id}: ${o.scripted}ms of beats in a ${o.dur}ms scene`)
  }
  process.exit(1)
}

console.log('All scenes fit their screen time.\n')
