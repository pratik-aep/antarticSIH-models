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


class GridRouter:
    """A* shortest path over the water cells of the LandMask grid."""

    def __init__(self, mask: LandMask):
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

    def shortest_path(self, from_lat, from_lon, to_lat, to_lon):
        r0, c0 = self.cell_index(from_lat, from_lon)
        rg, cg = self.cell_index(to_lat, to_lon)
        if (r0, c0) == (rg, cg):
            return [(from_lat, from_lon)]
        start = r0 * NCOLS + c0
        goal = rg * NCOLS + cg
        if self.mask.land[start] or self.mask.land[goal]:
            raise ValueError("no navigable water near a route endpoint")

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
                for n in path:
                    pts.append((self.lats[n // NCOLS], self.lons[n % NCOLS]))
                return pts
            for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
                rr = n_r + dr
                cc = (n_c + dc) % NCOLS
                if rr < 0 or rr >= NROWS:
                    continue
                lat_rr = self.lats[rr]
                if lat_rr > self.nav_top_lat:
                    continue
                nb = rr * NCOLS + cc
                if self.mask.land[nb]:
                    continue
                edge = self._edge(n_r, n_c, rr, cc)
                if lat_rr > self.arctic_pen_lat:
                    d = lat_rr - self.arctic_pen_lat
                    edge += self.arctic_penalty_per_nm * d * d * geo.NM_TO_M
                tentative = g[node] + edge
                if tentative < g.get(nb, float("inf")):
                    g[nb] = tentative
                    came[nb] = node
                    h = geo.haversine(self.lats[rr], (self.lons[cc] % 360.0) - 180.0, to_lat, to_lon)
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
    def __init__(self, mask: LandMask, ecas: list, chokepoints: list):
        self.mask = mask
        self.router = GridRouter(mask)
        self.ecas = ecas                      # list of (name, MultiPolygon)
        self.chokepoints = chokepoints        # list of (name, [[lon, lat], [lon, lat]])

    # ------------------------------------------------------------------ Stage A
    def _gc_path(self, a, b, step_nm=20.0):
        pts = geo.sample_geodesic(a.lat, a.lon, b.lat, b.lon, step_nm)
        if pts and pts[-1] != (b.lat, b.lon):
            pts.append((b.lat, b.lon))
        return pts

    # ------------------------------------------------------------------ Stage B
    def _land_avoid_path(self, a, b):
        sa = self.mask.nearest_water(a.lat, a.lon)
        sb = self.mask.nearest_water(b.lat, b.lon)
        if sa is None:
            raise RouteError(f"'{a.label}' is not reachable from navigable water")
        if sb is None:
            raise RouteError(f"'{b.label}' is not reachable from navigable water")
        try:
            centers = self.router.shortest_path(sa[0], sa[1], sb[0], sb[1])
        except ValueError as exc:
            raise RouteError(str(exc)) from exc
        interior = centers[1:-1] if len(centers) > 1 else []
        if len(centers) > 1 and centers[0] == centers[-1]:
            interior = []
        if interior:
            reduced = _douglas_peucker(interior, eps=1.1)
            reduced = _shortcut_water(reduced, self.mask)
            reduced = _ensure_safe(reduced, centers, self.mask)
            interior = _resample(reduced, 20.0)
        pts = [(a.lat, a.lon)] + list(interior) + [(b.lat, b.lon)]
        out = []
        for p in pts:
            if not out or p != out[-1]:
                out.append(p)
        return out

    def _leg_path(self, a, b):
        gc = self._gc_path(a, b)
        if _check_free(gc, self.mask):
            return gc
        return self._land_avoid_path(a, b)

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
                    # Coarse-grid tolerance: the 0.5° A* channel can thread
                    # through a strait at an offset (up to ~a grid cell) from
                    # the reference throat line below. Count a transit when the
                    # route runs within one grid cell of the line, using the
                    # strait's centre to place the crossing along the route.
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

    def compute_route(self, waypoints, speed_knots, departure_time_utc, optimize_for="distance"):
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
                path = self._leg_path(a, b)
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
        }