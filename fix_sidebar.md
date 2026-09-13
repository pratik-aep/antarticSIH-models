# Fixes tried: independent sidebar scrolling

Goal: make the left sidebar (`aside.panel` in `frontend/src`) scrollable on its own — independent of the map and the page.

## Layout model

```
.app                 display:flex; height:100%; overflow:hidden
├─ .panel (aside)    width:372px; height:100%; display:flex; flex-direction:column
│  ├─ .panel-header  fixed header (brand + tabs)
│  └─ .planner-body  flex:1; min-height:0; overflow-y:scroll   <-- scroll region
└─ .map-wrap / .map  flex:1 → MapLibre GL map
```

HTML/Body/#root are `height:100%` (`styles.css:15`). `.planner-body` is the flex child that should scroll.

## What was tried

### 1. Confirmed the intended scroll container had the right rules initially
`.planner-body` already had `flex:1; min-height:0; overflow-y:auto`. On paper this flex pattern should work. Probed the live dev page (headless Chrome + Puppeteer at 700px viewport):

- `.app` clientH=700, scrollH=700
- `.panel` clientH=700, scrollH=700
- `.planner-body` clientH=612, scrollH=813 after adding 10+ waypoints → **the container was generating overflow**
- Computed style confirmed `overflow-y:auto` and `min-height:0` were applied

Conclusion: the CSS *was* enabling scrolling — the wheel probe just didn't test the correct direction.

### 2. Initial wheel probe gave a false negative
Dispatched `page.mouse.wheel({ deltaY: -300 })` over the panel at x=180 → `scrollTop` stayed 0. This looked like "not scrollable".

### 3. Fixed the probe direction — scrolling actually works
Negative deltaY scrolls toward the top; the list was already at `scrollTop=0`. Re-ran with `deltaY: 400`:

- wheel over panel (x=180): `scrollTop` 0 → 201
- wheel over the map (x=700): sidebar `scrollTop` unchanged

MapLibre does NOT attach document/window-level wheel listeners (`mapCanvasHit:true`, no global capture); scrolling over the sidebar never zoomed the map.

### 4. Ruled out a stale build
Checked every server and the built output:
- Only vite dev serves this app (`:5173`). Port `:8080` is an unrelated site; `:8600` is the Python API.
- `dist/assets/*.css` already contained `planner-body{flex:1;overflow-y:auto;...min-height:0}`.
- No `vite preview`/`http.server` for this repo was running.

### 5. Identified the real UX problem
Everything functioned, but with macOS overlay scrollbars a `overflow-y:auto` sidebar shows nothing until the content overflows, so it *looks* dead even though it scrolls. "Make it scrollable" read as "make it visibly and robustly scrollable".

## The applied fix (`frontend/src/styles.css`)

```css
.panel {
  ... overflow: hidden;   /* contained; nothing can bleed out of the sidebar */
}

.planner-body {
  flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 14px; padding: 14px;
  overflow-y: scroll;                    /* scroll region is always a scroll region */
  scrollbar-gutter: stable;              /* reserves the track -> scrollbar always visible */
  overscroll-behavior-y: contain;        /* wheel stops at the sidebar, never chains away */
  -webkit-overflow-scrolling: touch;     /* momentum scrolling on iOS */
}
```

## Verification after the fix (Puppeteer on live dev server)

- Baseline (2 waypoints): `overflow-y:scroll`, `scrollbar-gutter:stable`, `overscroll-behavior-y:contain` applied.
- Overflow case (16 waypoints): clientH=612, scrollH=985.
- Wheel over the panel: `scrollTop` 0 → 373. Independent scrolling confirmed.

Also ran `npm run build` so `dist/` reflects the change.

## Files touched

- `frontend/src/styles.css` — `.panel` (`overflow:hidden`), `.planner-body` (scroll + gutter + overscroll)
- Rebuilt `frontend/dist` via `npm run build`