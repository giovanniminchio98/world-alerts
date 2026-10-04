// Convert normalised incidents (already filtered) into flat GeoJSON for map rendering.
import { ICON_TYPES } from './icons.js';
import { fireColorKey } from '../lib/colors.js';
import { summaryCellCount, thermalRowMatches } from '../lib/filters.js';

const fc = (features) => ({ type: 'FeatureCollection', features });

export const MAJOR_MAGNITUDE = 4.5;

export function earthquakesToMap(features) {
  const major = [];
  const minor = [];
  for (const f of features) {
    const p = f.properties;
    const mag = Number.isFinite(p.severity.numeric) ? p.severity.numeric : 0;
    const out = {
      type: 'Feature',
      geometry: f.geometry,
      properties: { fid: p.id, mag, color: p.severity.colorHint || 'gray', label: p.severity.label },
    };
    (mag >= MAJOR_MAGNITUDE || p.attributes?.significant ? major : minor).push(out);
  }
  // Draw larger events last so they sit on top.
  major.sort((a, b) => a.properties.mag - b.properties.mag);
  return { major: fc(major), minor: fc(minor) };
}

export function disastersToMap(features) {
  const points = [];
  const areas = [];
  const tracks = [];
  for (const f of features) {
    const p = f.properties;
    const color = p.severity.colorHint || 'gray';
    points.push({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        fid: p.id,
        hazard: ICON_TYPES.includes(p.subtype) ? p.subtype : 'default',
        color,
        representative: p.locationPrecision === 'representative',
      },
    });
    if (p.affectedGeometry) areas.push({ type: 'Feature', geometry: p.affectedGeometry, properties: { fid: p.id, color } });
    if (p.attributes?.track) tracks.push({ type: 'Feature', geometry: p.attributes.track, properties: { fid: p.id, color } });
  }
  return { points: fc(points), areas: fc(areas), tracks: fc(tracks) };
}

export function weatherToMap(features) {
  return fc(
    features.map((f) => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: { fid: f.properties.id, color: f.properties.severity.colorHint || 'gray' },
    })),
  );
}

const abbreviate = (n) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export function fireSummaryToMap(summary, filters) {
  const features = [];
  for (const [lon, lat, , , counts] of summary?.rows || []) {
    const count = summaryCellCount(counts, filters);
    if (!count) continue;
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { count, countLabel: abbreviate(count) } });
  }
  return fc(features);
}

/** Returns { fc, rows } — `rows[i]` is the detection behind feature fid `fire:i`. */
export function fireDetailToMap(rows, filters, now) {
  const kept = [];
  const features = [];
  const nowMin = now / 60_000;
  for (const row of rows) {
    if (!thermalRowMatches(row, filters, now)) continue;
    const i = kept.push(row) - 1;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [row[0], row[1]] },
      properties: { fid: `fire:${i}`, tone: fireColorKey(row[4], nowMin - row[2]) },
    });
  }
  return { fc: fc(features), rows: kept };
}
