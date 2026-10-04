// USGS Earthquake Hazards Program — "all earthquakes, past 7 days" GeoJSON summary feed.
// https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php

import { makeIncident, sortIncidents } from '../../src/shared/schema.js';
import { toIsoUtc } from '../../src/shared/time.js';
import { round } from '../../src/shared/geo.js';
import { earthquakeColorHint, USGS_SIGNIFICANCE_THRESHOLD } from '../../src/shared/severity.js';

export const key = 'usgs-earthquakes';
const FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson';

export async function fetchRaw(ctx) {
  return ctx.fetchJson(process.env.USGS_FEED_URL || FEED_URL, { timeoutMs: 60_000 });
}

const TYPE_LABELS = {
  earthquake: 'Earthquake',
  'quarry blast': 'Quarry blast',
  explosion: 'Explosion',
  'ice quake': 'Ice quake',
  'mining explosion': 'Mining explosion',
  'other event': 'Other seismic event',
};

export function normalize(raw, ctx) {
  if (raw?.type !== 'FeatureCollection' || !Array.isArray(raw.features)) {
    throw new Error('USGS response is not a GeoJSON FeatureCollection');
  }
  const fetchedUtc = ctx.nowIso;
  const features = [];
  for (const f of raw.features) {
    const p = f.properties || {};
    const c = f.geometry?.coordinates;
    if (!f.id || !Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    const mag = Number.isFinite(p.mag) ? round(p.mag, 1) : null;
    const depthKm = Number.isFinite(c[2]) ? round(c[2], 1) : null;
    const type = p.type || 'earthquake';
    const typeLabel = TYPE_LABELS[type] || type;
    const magText = mag == null ? 'Unknown magnitude' : `Magnitude ${mag.toFixed(1)}${p.magType ? ` (${p.magType})` : ''}`;
    const sig = Number.isFinite(p.sig) ? p.sig : null;
    features.push(
      makeIncident({
        id: `usgs:${f.id}`,
        source: 'USGS',
        sourceKey: key,
        sourceUrl: p.url || `https://earthquake.usgs.gov/earthquakes/eventpage/${f.id}`,
        category: 'earthquake',
        subtype: type,
        title: p.title || `${mag == null ? 'M ?' : `M ${mag.toFixed(1)}`} - ${p.place || 'Unknown location'}`,
        summary: `${magText} ${typeLabel.toLowerCase()}${depthKm == null ? '' : ` at ${depthKm} km depth`}`,
        severity: {
          label: mag == null ? 'M ?' : `M ${mag.toFixed(1)}`,
          numeric: mag,
          sourceLevel: p.alert || null,
          colorHint: earthquakeColorHint(mag),
        },
        geometry: { type: 'Point', coordinates: [round(c[0], 4), round(c[1], 4)] },
        locationPrecision: 'exact',
        eventStartUtc: toIsoUtc(p.time),
        sourceUpdatedUtc: toIsoUtc(p.updated),
        fetchedUtc,
        regionText: p.place || null,
        attributes: {
          depthKm,
          magType: p.magType || null,
          tsunami: p.tsunami === 1,
          pagerAlert: p.alert || null,
          significance: sig,
          significant: sig != null && sig >= USGS_SIGNIFICANCE_THRESHOLD,
          felt: Number.isFinite(p.felt) ? p.felt : null,
          mmi: Number.isFinite(p.mmi) ? round(p.mmi, 1) : null,
          reviewStatus: p.status || null,
          network: p.net || null,
          eventType: type,
        },
        attribution: 'USGS',
      }),
    );
  }
  const sorted = sortIncidents(features);
  const newest = sorted[0]?.properties.eventStartUtc ?? null;
  return {
    records: sorted.length,
    minExpectedRecords: 1,
    sourceLatestDataTimeUtc: toIsoUtc(raw.metadata?.generated) ?? null,
    sourceLastEventTimeUtc: newest,
    files: {
      [`incidents/${key}.json`]: {
        type: 'FeatureCollection',
        sourceKey: key,
        fetchedUtc,
        sourceGeneratedUtc: toIsoUtc(raw.metadata?.generated),
        disclaimer: 'Earthquake parameters (magnitude, location, depth) can be revised by USGS after publication.',
        features: sorted,
      },
    },
  };
}
