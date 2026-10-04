// Pure geographic helpers shared by the browser app and the Node refresh scripts.
// All coordinates are [longitude, latitude] in decimal degrees (GeoJSON order).

export const EARTH_RADIUS_KM = 6371;
export const KM_PER_MILE = 1.609344;

const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

/**
 * Great-circle distance in kilometres using the Haversine formula:
 * d = 2R · asin( sqrt( sin²(Δφ/2) + cos φ1 · cos φ2 · sin²(Δλ/2) ) )
 */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing (forward azimuth) from point 1 to point 2, in degrees 0–360. */
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const COMPASS_8 = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
const COMPASS_8_SHORT = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Eight-point compass direction for a bearing, e.g. 135 → "southeast". */
export function compassDirection(bearing, { short = false } = {}) {
  const normalized = ((bearing % 360) + 360) % 360;
  const index = Math.round(normalized / 45) % 8;
  return short ? COMPASS_8_SHORT[index] : COMPASS_8[index];
}

/**
 * Distance + direction of `target` as seen from `origin`.
 * Returns e.g. { km: 78.2, bearing: 131, direction: "southeast" }.
 */
export function relativePosition(origin, target) {
  const [lon1, lat1] = origin;
  const [lon2, lat2] = target;
  const km = haversineKm(lat1, lon1, lat2, lon2);
  const bearing = bearingDeg(lat1, lon1, lat2, lon2);
  return { km, bearing, direction: compassDirection(bearing) };
}

/** Format a distance in the requested unit ("km" or "mi"). */
export function formatDistance(km, unit = 'km') {
  if (!Number.isFinite(km)) return '';
  const value = unit === 'mi' ? km / KM_PER_MILE : km;
  const label = unit === 'mi' ? 'mi' : 'km';
  if (value < 1) return `<1 ${label}`;
  if (value < 10) return `${value.toFixed(1)} ${label}`;
  return `${Math.round(value).toLocaleString('en-US')} ${label}`;
}

/** "78 km southeast" — or "at the selected location" when very close. */
export function describeRelativePosition(origin, target, unit = 'km') {
  const { km, direction } = relativePosition(origin, target);
  if (km < 1) return 'at the selected location';
  return `${formatDistance(km, unit)} ${direction}`;
}

/** Ray-casting point-in-ring test. `ring` is an array of [lon, lat]. */
export function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Point in a GeoJSON Polygon's coordinates (outer ring minus holes). */
export function pointInPolygonCoords(point, rings) {
  if (!rings?.length || !pointInRing(point, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(point, rings[i])) return false;
  }
  return true;
}

/**
 * True when a [lon, lat] point lies inside a Polygon / MultiPolygon / GeometryCollection.
 * Point and line geometries never "contain" a location.
 */
export function geometryContainsPoint(geometry, point) {
  if (!geometry) return false;
  switch (geometry.type) {
    case 'Polygon':
      return pointInPolygonCoords(point, geometry.coordinates);
    case 'MultiPolygon':
      return geometry.coordinates.some((poly) => pointInPolygonCoords(point, poly));
    case 'GeometryCollection':
      return geometry.geometries.some((g) => geometryContainsPoint(g, point));
    default:
      return false;
  }
}

/** True when the geometry contains at least one polygon. */
export function hasAreaGeometry(geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') return true;
  if (geometry.type === 'GeometryCollection') return geometry.geometries.some(hasAreaGeometry);
  return false;
}

/** Bounding box [minLon, minLat, maxLon, maxLat] of any GeoJSON geometry. */
export function geometryBbox(geometry) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (coords) => {
    if (typeof coords[0] === 'number') {
      if (coords[0] < box[0]) box[0] = coords[0];
      if (coords[1] < box[1]) box[1] = coords[1];
      if (coords[0] > box[2]) box[2] = coords[0];
      if (coords[1] > box[3]) box[3] = coords[1];
      return;
    }
    for (const c of coords) visit(c);
  };
  if (!geometry) return null;
  if (geometry.type === 'GeometryCollection') {
    for (const g of geometry.geometries) {
      const b = geometryBbox(g);
      if (!b) continue;
      box[0] = Math.min(box[0], b[0]);
      box[1] = Math.min(box[1], b[1]);
      box[2] = Math.max(box[2], b[2]);
      box[3] = Math.max(box[3], b[3]);
    }
  } else if (geometry.coordinates) {
    visit(geometry.coordinates);
  }
  return Number.isFinite(box[0]) ? box : null;
}

/**
 * Rough lat/lon bounding box of a circle of `radiusKm` around a point.
 * Used to pick which data tiles to load; exact filtering still uses Haversine.
 */
export function radiusBbox(lon, lat, radiusKm) {
  const dLat = toDeg(radiusKm / EARTH_RADIUS_KM);
  const cosLat = Math.max(0.01, Math.cos(toRad(lat)));
  const dLon = Math.min(180, toDeg(radiusKm / (EARTH_RADIUS_KM * cosLat)));
  return [lon - dLon, Math.max(-90, lat - dLat), lon + dLon, Math.min(90, lat + dLat)];
}

/**
 * Filter point records by distance. `getCoords` returns [lon, lat].
 * Returns new objects `{ item, km, bearing, direction }` sorted nearest first.
 */
export function filterByRadius(items, origin, radiusKm, getCoords) {
  const out = [];
  for (const item of items) {
    const coords = getCoords(item);
    if (!coords) continue;
    const pos = relativePosition(origin, coords);
    if (pos.km <= radiusKm) out.push({ item, ...pos });
  }
  out.sort((a, b) => a.km - b.km);
  return out;
}

/** Normalise a longitude to the range [-180, 180). */
export function wrapLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Round a number to `digits` decimals (used to shrink published coordinates). */
export function round(value, digits) {
  if (!Number.isFinite(value)) return value;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Ramer–Douglas–Peucker simplification for a ring/line of [lon, lat]. */
export function simplifyLine(points, tolerance) {
  if (points.length <= 3) return points.slice();
  const sqTol = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxSq = 0;
    let index = -1;
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      let t = lenSq ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const sq = ex * ex + ey * ey;
      if (sq > maxSq) {
        maxSq = sq;
        index = i;
      }
    }
    if (index !== -1 && maxSq > sqTol) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Simplify + round a Polygon/MultiPolygon. Rings that collapse are dropped. */
export function simplifyGeometry(geometry, tolerance = 0.01, digits = 3) {
  if (!geometry) return null;
  const ring = (r) => {
    const s = simplifyLine(r, tolerance).map(([x, y]) => [round(x, digits), round(y, digits)]);
    if (s.length < 4) return null;
    const [fx, fy] = s[0];
    const [lx, ly] = s[s.length - 1];
    if (fx !== lx || fy !== ly) s.push([fx, fy]);
    return s;
  };
  const poly = (rings) => {
    const out = rings.map(ring).filter(Boolean);
    return out.length ? out : null;
  };
  if (geometry.type === 'Polygon') {
    const p = poly(geometry.coordinates);
    return p ? { type: 'Polygon', coordinates: p } : null;
  }
  if (geometry.type === 'MultiPolygon') {
    const ps = geometry.coordinates.map(poly).filter(Boolean);
    return ps.length ? { type: 'MultiPolygon', coordinates: ps } : null;
  }
  if (geometry.type === 'LineString') {
    return {
      type: 'LineString',
      coordinates: simplifyLine(geometry.coordinates, tolerance).map(([x, y]) => [round(x, digits), round(y, digits)]),
    };
  }
  return geometry;
}

/** Merge several Polygon/MultiPolygon geometries into a single MultiPolygon. */
export function mergePolygons(geometries) {
  const polys = [];
  for (const g of geometries) {
    if (!g) continue;
    if (g.type === 'Polygon') polys.push(g.coordinates);
    else if (g.type === 'MultiPolygon') polys.push(...g.coordinates);
  }
  if (!polys.length) return null;
  if (polys.length === 1) return { type: 'Polygon', coordinates: polys[0] };
  return { type: 'MultiPolygon', coordinates: polys };
}
