# Known limitations

## Route line occasionally clips land at narrow chokepoints

**What happens:** the rendered route occasionally cuts across a small strip of land (on the order of a few km) instead of following the coastline exactly. Confirmed on the Chennai → Gulfport route through the Suez Canal area (see screenshot from 2026-09-16), where the line briefly cuts across the canal bank near Port Said/Al Qantarah instead of tracking the waterway.

**Where this is expected to show up:** any narrow passage where the water is thin relative to the routing grid's resolution or the path's smoothing radius. The known chokepoints most at risk:

- Palk Strait (India / Sri Lanka)
- Bab el-Mandeb (Red Sea / Gulf of Aden)
- Suez Canal
- Strait of Gibraltar

These are exactly the places the router already treats specially for chokepoint-crossing detection — they're narrow by nature, which is why they're both notable crossings *and* the places most likely to show a land-clipping artifact.

**Root cause: not yet isolated to one of two candidates.**

1. **Grid resolution** — the land/sea navigability grid may be too coarse to represent the true width of the passage, so the pathfinder's raw path already cuts a corner before any smoothing happens.
2. **Path smoothing** — the raw grid path may be correct, and the corner-cutting/spline smoothing pass (which has no awareness of land) swings the curve across a tight bend that a straight-grid path would have followed correctly.

Diagnosis is still open: whichever it is (or both) should be confirmed by comparing the pre-smoothing and post-smoothing path at one of the four locations above before this is fixed for real, rather than guessing.

**Current severity: accepted, not blocking.** The clip is on the order of a few km, doesn't change the route's overall story, and is common even in commercial marine routing tools at this zoom level. Not worth a dedicated fix cycle on its own.

**Why this needs to be revisited before/alongside iceberg detection:** land-clipping is a cosmetic and minor-distance-accuracy problem today. Once iceberg/ice-edge avoidance is added, the same underlying weakness — a routing grid or smoothing pass that can cut corners past a boundary it's supposed to respect — becomes a safety-relevant precision problem instead of a cosmetic one. An ice-edge boundary should not be treated as more forgiving than a coastline; if anything it needs tighter tolerance, since ice edges (unlike a coastline) can shift and the "penalty" for cutting a corner is a real hazard rather than a slightly-off distance figure.

**Recommendation:** whatever fix approach is chosen for the land-clipping issue (finer grid at known chokepoints, land-polygon buffering, or post-smoothing re-validation against land) should be built as a general "respect a hard boundary" mechanism, not a special case for coastlines — so the same mechanism can be reused for the ice-edge boundary when that feature is built, rather than solving this twice.