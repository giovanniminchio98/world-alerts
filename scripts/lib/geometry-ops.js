// Geometry clean-up for published areas and tracks (build time only).
import polygonClipping from 'polygon-clipping';
import { mergePolygons } from '../../src/shared/geo.js';

const polygonsOf = (g) => (g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : []);

/**
 * Union overlapping polygons into one outline. GDACS publishes a cyclone as
 * dozens of overlapping wind circles (one per forecast step); drawn one by one
 * they stack into many lines. Falls back to a plain merge if the union fails.
 */
export function unionPolygons(geometries) {
  const polys = geometries.flatMap(polygonsOf);
  if (polys.length === 0) return null;
  if (polys.length === 1) return { type: 'Polygon', coordinates: polys[0] };
  try {
    const out = polygonClipping.union(...polys);
    if (!out.length) return null;
    return out.length === 1 ? { type: 'Polygon', coordinates: out[0] } : { type: 'MultiPolygon', coordinates: out };
  } catch {
    return mergePolygons(geometries);
  }
}

const keyOf = (c) => `${c[0].toFixed(4)},${c[1].toFixed(4)}`;

/**
 * Join directed track segments into continuous lines. GDACS sends a track as
 * many 2-point segments in no particular order; each segment points from an
 * older to a newer position, so following end → start links them into the
 * storm's path and arrows along it point the way the storm moves.
 */
export function joinSegments(lines) {
  const segments = lines
    .flatMap((l) => (l?.type === 'LineString' ? [l.coordinates] : l?.type === 'MultiLineString' ? l.coordinates : []))
    .filter((s) => s.length >= 2);
  if (!segments.length) return null;
  const byStart = new Map();
  const ends = new Set();
  for (const seg of segments) {
    const k = keyOf(seg[0]);
    if (!byStart.has(k)) byStart.set(k, []);
    byStart.get(k).push(seg);
    ends.add(keyOf(seg[seg.length - 1]));
  }
  const used = new Set();
  const chains = [];
  const walk = (first) => {
    const chain = first.slice();
    used.add(first);
    for (;;) {
      const next = (byStart.get(keyOf(chain[chain.length - 1])) || []).find((s) => !used.has(s));
      if (!next) break;
      used.add(next);
      chain.push(...next.slice(1));
    }
    chains.push(chain);
  };
  // Start from segments nothing leads into (the oldest positions), then any leftovers.
  for (const seg of segments) if (!used.has(seg) && !ends.has(keyOf(seg[0]))) walk(seg);
  for (const seg of segments) if (!used.has(seg)) walk(seg);
  chains.sort((a, b) => b.length - a.length);
  return chains.length === 1 ? { type: 'LineString', coordinates: chains[0] } : { type: 'MultiLineString', coordinates: chains };
}
