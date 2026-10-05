// Convert normalised incidents (already filtered) into flat GeoJSON for map rendering.
import { hazardColor, hazardOf, nwsHazard } from './hazards.js';
import { fireColorKey } from '../lib/colors.js';
import { activityState, summaryCellCount, thermalRowMatches } from '../lib/filters.js';
import { unwrapGeometry } from '../shared/geo.js';

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

/**
 * GDACS / EONET events → icon points, affected-area polygons and tracks, each
 * carrying its hazard key and colour. `ring` is the icon ring colour hint (the
 * GDACS alert level as published; EONET has none). `ended` marks events that are
 * not ongoing (closed by the source, or no update for a day); they are drawn
 * faded and underneath.
 */
function eventsToMap(features, ring, now) {
  const points = [];
  const areas = [];
  const tracks = [];
  for (const f of features) {
    const p = f.properties;
    const hazard = hazardOf(p.subtype);
    const hcolor = hazardColor(hazard);
    const ended = activityState(p, now) !== 'ongoing';
    points.push({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        fid: p.id,
        hazard,
        hcolor,
        color: ring(p),
        representative: p.locationPrecision === 'representative',
        hasArea: Boolean(p.affectedGeometry),
        ended,
      },
    });
    // Unwrap at the antimeridian so a path or area crossing 180° is not drawn around the world.
    if (p.affectedGeometry) areas.push({ type: 'Feature', geometry: unwrapGeometry(p.affectedGeometry), properties: { fid: p.id, hazard, hcolor, ended } });
    if (p.attributes?.track) tracks.push({ type: 'Feature', geometry: unwrapGeometry(p.attributes.track), properties: { fid: p.id, hazard, hcolor, ended } });
  }
  const endedFirst = (a, b) => Number(b.properties.ended) - Number(a.properties.ended);
  return { points: fc(points.sort(endedFirst)), areas: fc(areas.sort(endedFirst)), tracks: fc(tracks.sort(endedFirst)) };
}

export const disastersToMap = (features, now = Date.now()) => eventsToMap(features, (p) => p.severity.colorHint || 'gray', now);
export const naturalToMap = (features, now = Date.now()) => eventsToMap(features, () => 'natural', now);

export function weatherToMap(features) {
  return fc(
    features.map((f) => {
      const hazard = nwsHazard(f.properties.attributes?.event);
      const props = { fid: f.properties.id, color: f.properties.severity.colorHint || 'gray' };
      if (hazard) Object.assign(props, { hazard, hcolor: hazardColor(hazard) });
      return { type: 'Feature', geometry: unwrapGeometry(f.geometry), properties: props };
    }),
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
