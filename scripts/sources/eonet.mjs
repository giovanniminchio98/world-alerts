// NASA EONET — Earth Observatory Natural Event Tracker (open events).
// https://eonet.gsfc.nasa.gov/docs/v3
//
// EONET curates natural events (wildfires, severe storms, volcanoes, floods,
// landslides, dust, snow, temperature extremes…) from many agencies and links
// to the original source. It publishes no severity level of its own.

import { makeIncident, sortIncidents } from '../../src/shared/schema.js';
import { parseUtc, toIsoUtc } from '../../src/shared/time.js';
import { geometryBbox, round, simplifyGeometry, unwrapLongitudes } from '../../src/shared/geo.js';
import { NATURAL_TYPES } from '../../src/shared/severity.js';

export const key = 'eonet-events';
const API_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=60';

/** EONET categories shown; earthquakes come from USGS and sea/lake ice is not place-relevant. */
export const EONET_CATEGORIES = NATURAL_TYPES;

/** Hazards where EONET's coordinate is the event location rather than a moving/broad area. */
const POINT_HAZARDS = new Set(['wildfires', 'volcanoes', 'landslides']);

export async function fetchRaw(ctx) {
  const json = await ctx.fetchJson(process.env.EONET_URL || API_URL, { timeoutMs: 90_000 });
  if (!Array.isArray(json?.events)) throw new Error('EONET response has no events array');
  return json;
}

const magnitudeLabel = (g) => {
  if (!g || g.magnitudeValue == null || !g.magnitudeUnit) return null;
  const v = Number(g.magnitudeValue);
  return Number.isFinite(v) ? `${v.toLocaleString('en-US', { maximumFractionDigits: 1 })} ${g.magnitudeUnit}` : null;
};

export function normalize(raw, ctx) {
  const fetchedUtc = ctx.nowIso;
  const features = [];
  for (const ev of raw.events || []) {
    const cat = (ev.categories || []).map((c) => c.id).find((id) => EONET_CATEGORIES[id]);
    if (!cat || !ev.id) continue;
    const geoms = (ev.geometry || ev.geometries || [])
      .filter((g) => g && g.type && g.coordinates)
      .sort((a, b) => (parseUtc(a.date) ?? 0) - (parseUtc(b.date) ?? 0));
    if (!geoms.length) continue;
    const latest = geoms[geoms.length - 1];
    const points = geoms.filter((g) => g.type === 'Point' && Number.isFinite(g.coordinates[0]) && Number.isFinite(g.coordinates[1]));
    const polygons = geoms.filter((g) => g.type === 'Polygon');

    let coords;
    let affected = null;
    if (latest.type === 'Point') coords = latest.coordinates;
    else if (latest.type === 'Polygon') {
      affected = simplifyGeometry({ type: 'Polygon', coordinates: latest.coordinates }, 0.01, 3);
      const b = geometryBbox(affected);
      if (b) coords = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    }
    if (!coords && points.length) coords = points[points.length - 1].coordinates;
    if (!coords && polygons.length) {
      const b = geometryBbox({ type: 'Polygon', coordinates: polygons[polygons.length - 1].coordinates });
      coords = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    }
    if (!coords) continue;

    // Storms and other moving events: keep the path of reported positions as a track.
    const path = unwrapLongitudes(points.map((g) => [round(g.coordinates[0], 3), round(g.coordinates[1], 3)]));
    const moved = new Set(path.map((c) => c.join(','))).size > 1;
    const track = moved ? { type: 'LineString', coordinates: path } : null;
    const precision = affected ? 'area' : POINT_HAZARDS.has(cat) ? 'exact' : 'representative';
    const sources = (ev.sources || []).filter((s) => /^https?:\/\//.test(s.url || ''));
    const label = EONET_CATEGORIES[cat];
    const mag = magnitudeLabel(latest);

    features.push(
      makeIncident({
        id: `eonet:${ev.id}`,
        source: 'NASA EONET',
        sourceKey: key,
        sourceUrl: sources[0]?.url || `https://eonet.gsfc.nasa.gov/api/v3/events/${ev.id}`,
        category: 'natural',
        subtype: cat,
        title: ev.title || label,
        summary: [label, mag, ev.description].filter(Boolean).join(' · '),
        severity: { label: mag || 'Not classified by source', numeric: null, sourceLevel: null, colorHint: null },
        geometry: { type: 'Point', coordinates: [round(coords[0], 4), round(coords[1], 4)] },
        affectedGeometry: affected,
        locationPrecision: precision,
        eventStartUtc: toIsoUtc(geoms[0].date),
        eventEndUtc: toIsoUtc(ev.closed),
        sourceUpdatedUtc: toIsoUtc(latest.date),
        fetchedUtc,
        countryCodes: [],
        regionText: null,
        attributes: {
          eventType: cat,
          eventLabel: label,
          magnitude: mag,
          positions: points.length,
          track,
          originalSources: sources.map((s) => ({ id: s.id, url: s.url })),
          eonetId: ev.id,
        },
        disclaimer:
          precision === 'representative'
            ? 'Latest reported position — the affected area may be much broader. EONET curates events from other agencies; follow the linked original source.'
            : 'EONET curates events from other agencies; follow the linked original source for current details.',
        attribution: 'NASA EONET',
        status: ev.closed ? 'past' : 'active',
      }),
    );
  }
  const sorted = sortIncidents(features);
  const latestUpdate = sorted.map((f) => parseUtc(f.properties.sourceUpdatedUtc)).filter(Boolean).sort((a, b) => b - a)[0];
  return {
    records: sorted.length,
    minExpectedRecords: 0,
    sourceLatestDataTimeUtc: toIsoUtc(latestUpdate) ?? null,
    sourceLastEventTimeUtc: sorted[0]?.properties.eventStartUtc ?? null,
    files: {
      [`incidents/${key}.json`]: {
        type: 'FeatureCollection',
        sourceKey: key,
        fetchedUtc,
        disclaimer: 'NASA EONET lists open natural events curated from other agencies; it does not assign severity levels.',
        features: sorted,
      },
    },
  };
}
