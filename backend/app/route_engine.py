"""Route computation pipeline (Stages A-E).

Stage A  geodesic base route
Stage B  land avoidance via A* over the coarse navigable-water grid
Stage C  chokepoint / crossing detection
Stage D  ECA distance
Stage E  time / ETA (kept isolated so Phase 2 can swap in current-aware timing)
"""

from __future__ import annotations

import heapq
import math

import shapely.geometry as sgeo

from . import geo
from .mask import LandMask, LAT_TOP, LON_LEFT, NROWS, NCOLS, SPACING

A_STAR = True

# Max planar-degrees distance from a strait/canal reference throat line within
# which a route still counts as transiting it. The coarse 0.5° grid's channel
# can sit up to ~0.4° from the hand-placed line (half a grid diagonal + resample
# slack), yet still be "through" the strait.
STRAIT_TOL_DEG = 0.4


def build_waterway_midline(w, step_nm=6.0):
    """Dense polyline along the full canal+gulf path of an artificial waterway.

    `w` is a waterway dict with `from`/`to` (open-water connect points) and
    `via` (intermediate real-canal waypoints). The same polyline is used for
    three purposes: A* edge cost, the rendered/spliced route geometry, and the
    mask carving that keeps it water at coarse resolution.
    """
    chain = [tuple(w["from"])] + [tuple(p) for p in w.get("via", [])] + [tuple(w["to"])]
    out = []
    for p, q in zip(chain, chain[1:]):
        sub = geo.sample_geodesic(p[0], p[1], q[0], q[1], step_nm)
        for x in sub:
            if not out or x != out[-1]:
                out.append(x)
        if not out:
            out.append(p)
    return out


class GridRouter:
    """A* shortest path over the water cells of the LandMask grid.

    Artificial waterways (Suez / Panama / Kiel) are added as shortcut edges
    between two snap-to-water cells, costed at their real canal
    length (in metres, matching the metre-valued grid edges). When the search
    uses such an edge, the canonical canal midline is spliced into the returned
    polyline so rendering, crossing detection and ECA all see the canal line.
    """

    def __init__(self, mask: LandMask, waterways=()):
        self.mask = mask
        self.lats = [LAT_TOP - r * SPACING for r in range(NROWS)]
        self.lons = [LON_LEFT + c * SPACING for c in range(NCOLS)]
        # Permanent Arctic pack-ice latitude: the A* graph is not navigable
        # above this, so the model can't cheat a transcontinental shortcut
        # over the North Pole (Suez/Panama are not resolvable at 0.5 deg).
        self.nav_top_lat = 78.0
        # Above this latitude (northern hemisphere only) edges are penalised so
        # that far-north meanders (Arctic shortcutting) lose to low-latitude
        # shipping lanes, while still permitting genuine high-latitude routes
        # when both endpoints demand them. No southern-hemisphere penalty:
        # the Southern Ocean is a legitimate routing space for Antarctic legs.
        self.arctic_pen_lat = 65.0
        self.arctic_penalty_per_nm = 0.2
        self._build_waterways(waterways)

    def _build_waterways(self, waterways):
        self.waterways = {}       # node index -> [(neighbour node, cost m, name)]
        self.waterway_lines = {}  # (nodeA, nodeB) -> [(lat, lon)...] canal midline
        for w in waterways:
            midline = build_waterway_midline(w)
            if len(midline) < 2:
                print(f"[route] waterway '{w['name']}' has no midline — skipped", flush=True)
                continue
            sn_a = self.mask.nearest_water(w["from"][0], w["from"][1], max_radius=8)
            sn_b = self.mask.nearest_water(w["to"][0], w["to"][1], max_radius=8)
            if sn_a is None or sn_b is None:
                print(f"[route] waterway '{w['name']}' endpoint not near navigable water — skipped", flush=True)
                continue
            nA = self.cell_index(sn_a[0], sn_a[1])
            nB = self.cell_index(sn_b[0], sn_b[1])
            iA = nA[0] * NCOLS + nA[1]
            iB = nB[0] * NCOLS + nB[1]
            if iA == iB:
                print(f"[route] waterway '{w['name']}' endpoints share a cell — skipped", flush=True)
                continue
            cost_m = geo.polyline_length_nm(midline) * geo.NM_TO_M
            self.waterways.setdefault(iA, []).append((iB, cost_m, w["name"]))
            self.waterways.setdefault(iB, []).append((iA, cost_m, w["name"]))
            self.waterway_lines[(iA, iB)] = midline
            self.waterway_lines[(iB, iA)] = list(reversed(midline))
            print(f"[route] waterway '{w['name']}' loaded ({cost_m / geo.NM_TO_M:.0f} nm)", flush=True)

    def cell_index(self, lat, lon):
        r = round((LAT_TOP - lat) / SPACING)
        c = round((lon - LON_LEFT) / SPACING) % NCOLS
        if r < 0:
            r = 0
        if r >= NROWS:
            r = NROWS - 1
        return r, c

    def _edge(self, r1, c1, r2, c2) -> float:
        # exact haversine distance between the two cell centres
        return geo.haversine(
            self.lats[r1], self.lons[c1] % 360.0 - 180.0,
            self.lats[r2], ((self.lons[c2] % 360.0) - 180.0),
        )

    def shortest_path(self, from_lat, from_lon, to_lat, to_lon, vessel_type="cargo", ice_class="none"):
        r0, c0 = self.cell_index(from_lat, from_lon)
        rg, cg = self.cell_index(to_lat, to_lon)
        if (r0, c0) == (rg, cg):
            return [(from_lat, from_lon)]
        start = r0 * NCOLS + c0
        goal = rg * NCOLS + cg
        if self.mask.land[start] or self.mask.land[goal]:
            raise ValueError("no navigable water near a route endpoint")

        is_polar = vessel_type.lower() == "icebreaker" or ice_class.lower() in ("pc1_pc7", "icebreaker")
        nav_top = 88.0 if is_polar else self.nav_top_lat
        arctic_pen = 0.02 if is_polar else self.arctic_penalty_per_nm

        g = {start: 0.0}
        came = {}
        heap = [(geo.haversine(self.lats[r0], self.lons[c0], to_lat, to_lon), 0, start)]
        counter = 1
        closed = 0
        while heap:
            f, _, node = heapq.heappop(heap)
            n_r = node // NCOLS
            n_c = node % NCOLS
            if node == goal:
                path = []
                cur = node
                while cur is not None:
                    path.append(cur)
                    cur = came.get(cur)
                path.reverse()
                pts = []
                for i, n in enumerate(path):
                    pts.append((self.lats[n // NCOLS], self.lons[n % NCOLS]))
                    if i + 1 < len(path):
                        nxt = path[i + 1]
                        midline = self.waterway_lines.get((n, nxt))
                        if midline:
                            pts.extend(midline[1:-1])
                return pts
            for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
                rr = n_r + dr
                cc = (n_c + dc) % NCOLS
                if rr < 0 or rr >= NROWS:
                    continue
                lat_rr = self.lats[rr]
                if lat_rr > nav_top:
                    continue
                nb = rr * NCOLS + cc
                if self.mask.land[nb]:
                    continue
                if dr != 0 and dc != 0:
                    if self.mask.land[n_r * NCOLS + cc] or self.mask.land[rr * NCOLS + n_c]:
                        continue
                edge = self._edge(n_r, n_c, rr, cc)
                if lat_rr > self.arctic_pen_lat:
                    d = lat_rr - self.arctic_pen_lat
                    edge += arctic_pen * d * d * geo.NM_TO_M
                tentative = g[node] + edge
                if tentative < g.get(nb, float("inf")):
                    g[nb] = tentative
                    came[nb] = node
                    h = geo.haversine(self.lats[rr], (self.lons[cc] % 360.0) - 180.0, to_lat, to_lon)
                    heapq.heappush(heap, (tentative + h, counter, nb))
                    counter += 1
            for nb, wcost, _wname in self.waterways.get(node, ()):
                if self.mask.land[nb]:
                    continue
                tentative = g[node] + wcost
                if tentative < g.get(nb, float("inf")):
                    g[nb] = tentative
                    came[nb] = node
                    h = geo.haversine(
                        self.lats[nb // NCOLS], (self.lons[nb % NCOLS] % 360.0) - 180.0,
                        to_lat, to_lon,
                    )
                    heapq.heappush(heap, (tentative + h, counter, nb))
                    counter += 1
            closed += 1
            if closed > 800000:
                raise ValueError("land-avoidance search did not converge")
        raise ValueError("no navigable water route found (enclosed sea or blocked coast)")


def _check_free(pts, mask, step_nm=5.0) -> bool:
    """True when a polyline never enters a land cell (sampled denser than cells)."""
    for (la1, lo1), (la2, lo2) in zip(pts, pts[1:]):
        sub = geo.sample_geodesic(la1, lo1, la2, lo2, step_nm)
        for lat, lon in sub:
            if mask.cell(lat, lon):
                return False
    return True


def _perp_dist(p, a, b):
    lat_scale = max(abs(math.cos(math.radians((a[0] + b[0]) / 2.0))), 0.01)
    ax, ay = a[1] * lat_scale, a[0]
    bx, by = b[1] * lat_scale, b[0]
    px, py = p[1] * lat_scale, p[0]
    dx, dy = bx - ax, by - ay
    length = math.hypot(dx, dy)
    if length == 0:
        return math.hypot(px - ax, py - ay)
    return abs(dy * px - dx * py + bx * ay - by * ax) / length


def _douglas_peucker(pts, eps):
    if len(pts) < 3:
        return list(pts)
    dmax, idx = 0.0, 0
    a, b = pts[0], pts[-1]
    for i in range(1, len(pts) - 1):
        d = _perp_dist(pts[i], a, b)
        if d > dmax:
            dmax, idx = d, i
    if dmax > eps:
        left = _douglas_peucker(pts[: idx + 1], eps)
        right = _douglas_peucker(pts[idx:], eps)
        return left[:-1] + right
    return [pts[0], pts[-1]]


def _safe_shortcut(p1, p2, mask, max_north_lat=78.0):
    """Can we travel in a straight geodesic from p1 to p2 entirely on water,
    without entering the (ice-blocked) far-northern Arctic?"""
    pts = geo.sample_geodesic(p1[0], p1[1], p2[0], p2[1], 0.6 * SPACING)
    for lat, lon in pts:
        if lat > max_north_lat:
            return False
        if mask.cell(lat, lon):
            return False
    return True


def _shortcut_water(pts, mask):
    """Greedy merge of collinear water segments into geodesic jumps."""
    out = list(pts)
    i = 0
    while i < len(out) - 2:
        j = i + 2
        while j < len(out) and _safe_shortcut(out[i], out[j], mask):
            j += 1
        j -= 1
        if j > i + 1:
            del out[i + 1:j]
        i += 1
    return out


def _ensure_safe(pts, original_path, mask):
    """Repair any consecutive pair in `pts` whose geodesic would cross land
    (or the Arctic ice cap) by splicing back the original cell-path vertices."""
    out = []
    for p, q in zip(pts, pts[1:]):
        out.append(p)
        if _safe_shortcut(p, q, mask):
            continue
        try:
            i = original_path.index(p)
            j = original_path.index(q)
        except ValueError:
            i = j = -1
        if 0 <= i < j:
            for c in original_path[i + 1:j]:
                if c != out[-1]:
                    out.append(c)
    if pts:
        out.append(pts[-1])
    return out


def _resample(pts, step_nm=20.0) -> list[tuple[float, float]]:
    if len(pts) < 2:
        return list(pts)
    dense = [pts[0]]
    for (la1, lo1), (la2, lo2) in zip(pts, pts[1:]):
        seg = geo.sample_geodesic(la1, lo1, la2, lo2, step_nm)
        for p in seg[1:]:
            if p != dense[-1]:
                dense.append(p)
    return dense


def _chaikin(pts, iterations=1) -> list[tuple[float, float]]:
    """Corner-cutting curve smoothing (in lat/lon space).

    For each segment P0→P1 the two new control points are
        Q = P0 + 0.25*(P1-P0)   (near P0)
        R = P0 + 0.75*(P1-P0)   (near P1)
    Output order per segment is Q then R so the polyline always advances
    forward; emitting R then Q creates zigzag oscillations that inflate
    total distance by ~2.5×.
    """
    if len(pts) < 3:
        return list(pts)
    out = list(pts)
    for _ in range(iterations):
        if len(out) < 3:
            break
        nxt = []
        for i in range(len(out) - 1):
            la1, lo1 = out[i]
            la2, lo2 = out[i + 1]
            nxt.append((la1 + 0.25 * (la2 - la1), lo1 + 0.25 * (lo2 - lo1)))
            nxt.append((la1 + 0.75 * (la2 - la1), lo1 + 0.75 * (lo2 - lo1)))
        nxt.append(out[-1])
        out = nxt
    return out


def _smooth_safe(pts, mask, fallback=None):
    """Apply Chaikin corner-cutting, keeping only land-safe passes.

    The smoothed curve must never enter a land cell (sampled denser than the
    grid). Fall back to a lighter pass, then to the unsmoothed path, so a
    land-crossing artificial curve is never returned.
    """
    two = _chaikin(pts, 2)
    if _check_free(two, mask):
        return two
    one = _chaikin(pts, 1)
    if _check_free(one, mask):
        return one
    return fallback if fallback is not None else pts


class RouteError(Exception):
    pass


class WP:
    """Internal waypoint (backend-side endpoint).

    Endpoints are plain `{label, lat, lon}` structs — a port lookup is only one
    way to produce them. Research stations / open-ocean coords are equally valid.
    """

    __slots__ = ("label", "countryCode", "lat", "lon", "isPort", "id")

    def __init__(self, label, lat, lon, countryCode="", isPort=True, id=""):
        self.label = label
        self.lat = lat
        self.lon = lon
        self.countryCode = countryCode or ""
        self.isPort = isPort
        self.id = id or label

    def to_dict(self):
        return {
            "id": self.id,
            "label": self.label,
            "countryCode": self.countryCode,
            "lat": self.lat,
            "lon": self.lon,
            "isPort": self.isPort,
        }

    @staticmethod
    def from_maybe(w):
        if isinstance(w, WP):
            return w
        if hasattr(w, "lat"):
            return WP(
                label=str(w.label),
                lat=float(w.lat),
                lon=float(w.lon),
                countryCode=str(getattr(w, "countryCode", "") or ""),
                isPort=bool(getattr(w, "isPort", True)),
                id=str(getattr(w, "id", "") or str(getattr(w, "label", ""))),
            )
        return WP(
            label=str(w.get("label", "")),
            lat=float(w["lat"]),
            lon=float(w["lon"]),
            countryCode=str(w.get("countryCode", "") or ""),
            isPort=bool(w.get("isPort", True)),
            id=str(w.get("id", "") or str(w.get("label", ""))),
        )


class RouteEngine:
    def __init__(self, mask: LandMask, ecas: list, chokepoints: list, waterways=()):
        self.mask = mask
        self.router = GridRouter(mask, waterways=waterways)
        self.ecas = ecas                      # list of (name, MultiPolygon)
        self.chokepoints = chokepoints        # list of (name, [[lon, lat], [lon, lat]])

    # ------------------------------------------------------------------ Stage A
    def _gc_path(self, a, b, step_nm=20.0):
        pts = geo.sample_geodesic(a.lat, a.lon, b.lat, b.lon, step_nm)
        if pts and pts[-1] != (b.lat, b.lon):
            pts.append((b.lat, b.lon))
        return pts

    # ------------------------------------------------------------------ Stage B
    def _land_avoid_path(self, a, b, vessel_type="cargo", ice_class="none"):
        sa = self.mask.nearest_water(a.lat, a.lon)
        sb = self.mask.nearest_water(b.lat, b.lon)
        if sa is None:
            raise RouteError(f"'{a.label}' is not reachable from navigable water")
        if sb is None:
            raise RouteError(f"'{b.label}' is not reachable from navigable water")
        for label, p, s in ((a.label, a, sa), (b.label, b, sb)):
            snap_nm = geo.geodesic_distance_nm(p.lat, p.lon, s[0], s[1])
            if snap_nm > 30.0:
                print(
                    f"[route] large waypoint snap: '{label}' "
                    f"({p.lat:.2f}, {p.lon:.2f}) -> water ({s[0]:.2f}, {s[1]:.2f}) "
                    f"{snap_nm:.0f} nm",
                    flush=True,
                )
        try:
            centers = self.router.shortest_path(sa[0], sa[1], sb[0], sb[1], vessel_type=vessel_type, ice_class=ice_class)
        except ValueError as exc:
            raise RouteError(str(exc)) from exc
        interior = centers[1:-1] if len(centers) > 1 else []
        if len(centers) > 1 and centers[0] == centers[-1]:
            interior = []
        if interior:
            reduced = _douglas_peucker(interior, eps=1.1)
            reduced = _shortcut_water(reduced, self.mask)
            reduced = _ensure_safe(reduced, centers, self.mask)
            reduced = _smooth_safe(reduced, self.mask)
            interior = _resample(reduced, 20.0)
        pts = [(a.lat, a.lon)] + list(interior) + [(b.lat, b.lon)]
        out = []
        for p in pts:
            if not out or p != out[-1]:
                out.append(p)
        return out

    def _leg_path(self, a, b, vessel_type="cargo", ice_class="none"):
        gc = self._gc_path(a, b)
        if _check_free(gc, self.mask):
            return gc
        return self._land_avoid_path(a, b, vessel_type=vessel_type, ice_class=ice_class)

    # --------------------------------------------------------- Stages C and D
    def _eca_distance(self, path, eca_polys) -> float:
        line = sgeo.LineString([(lon, lat) for lat, lon in path])
        total = 0.0
        for poly in eca_polys:
            inter = line.intersection(poly)
            total += self._geom_length_nm(inter)
        return total

    def _geom_length_nm(self, geom):
        if geom.is_empty:
            return 0.0
        gtype = geom.geom_type
        if gtype in ("LineString", "LinearRing"):
            return geo.polyline_length_nm([(lat, lon) for lon, lat in geom.coords])
        if gtype in ("MultiLineString", "GeometryCollection"):
            total = 0.0
            for part in geom.geoms:
                if part.geom_type in ("LineString", "LinearRing"):
                    total += geo.polyline_length_nm([(lat, lon) for lon, lat in part.coords])
            return total
        return 0.0

    def _crossings(self, path):
        line = sgeo.LineString([(lon, lat) for lat, lon in path])
        hits = []
        for cp in self.chokepoints:
            name, kind = cp["name"], cp["kind"]
            if kind == "cape":
                pt = sgeo.Point(cp["point"])
                d_nm = self._point_line_distance_nm(pt, line)
                if d_nm <= cp["radiusNm"]:
                    nearest = line.interpolate(line.project(pt))
                    hits.append((line.project(nearest), name))
            else:
                seg_line = sgeo.LineString(cp["line"])
                inter = line.intersection(seg_line)
                if inter.is_empty:
                    if line.distance(seg_line) > STRAIT_TOL_DEG:
                        continue
                    param = line.project(seg_line.centroid)
                elif inter.geom_type == "Point":
                    param = line.project(inter)
                elif inter.geom_type == "MultiPoint":
                    param = min(line.project(p) for p in inter.geoms)
                else:
                    continue
                hits.append((param, name))
        hits.sort(key=lambda t: t[0])
        return [name for _, name in hits]

    def _point_line_distance_nm(self, pt, line):
        return geo.geodesic_distance_nm(pt.y, pt.x, line.interpolate(line.project(pt)).y, line.interpolate(line.project(pt)).x)

    # ------------------------------------------------------------------ Stage E
    @staticmethod
    def duration_hours(distance_nm, speed_knots):
        return distance_nm / max(speed_knots, 1e-9)

    def compute_route(self, waypoints, speed_knots, departure_time_utc, optimize_for="distance", vessel_type="cargo", draft_meters=10.0, ice_class="none"):
        from datetime import timedelta

        waypoints = [WP.from_maybe(w) for w in waypoints]

        legs = []
        totals_nm = totals_eca = 0.0
        all_crossings = []
        seen = set()
        for a, b in zip(waypoints, waypoints[1:]):
            if a.lat == b.lat and a.lon == b.lon:
                path = [(a.lat, a.lon)]
                dist = 0.0
            else:
                path = self._leg_path(a, b, vessel_type=vessel_type, ice_class=ice_class)
                dist = geo.polyline_length_nm(path)
            eca = self._eca_distance(path, [e[2] for e in self.ecas])
            crossing_list = self._crossings(path)
            legs.append({
                "from": a.to_dict(),
                "to": b.to_dict(),
                "path": [list(p) for p in path],
                "distanceNm": round(dist, 1),
                "distanceInEcaNm": round(eca, 1),
                "durationHours": round(dist / max(speed_knots, 1e-9), 2),
                "crossings": crossing_list,
            })
            totals_nm += dist
            totals_eca += eca
            for c in crossing_list:
                if c not in seen:
                    seen.add(c)
                    all_crossings.append(c)

        duration = totals_nm / max(speed_knots, 1e-9)
        eta = departure_time_utc + timedelta(hours=duration)
        return {
            "legs": legs,
            "totalDistanceNm": round(totals_nm, 1),
            "totalDistanceInEcaNm": round(totals_eca, 1),
            "totalDurationHours": round(duration, 2),
            "etaUTC": eta.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "crossings": all_crossings,
            "vessel": {
                "type": vessel_type,
                "draftMeters": draft_meters,
                "iceClass": ice_class,
            },
        }