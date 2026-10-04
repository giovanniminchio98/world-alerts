// Pure filtering functions shared by the map layers, the incident list and the
// location card, so every view applies exactly the same rules.

import { parseUtc, windowMinutes } from '../shared/time.js';
import { AGE_BUCKETS } from '../shared/firms-codec.js';
import { NATURAL_TYPES } from '../shared/severity.js';

export const DEFAULT_FILTERS = {
  window: '24h',
  // Satellite heat spots are numerous and mostly not wildfires: off on the map by default.
  layers: { earthquake: true, disaster: true, natural: true, thermal: false, weather: true },
  earthquake: { minMag: 0, depth: 'all', significantOnly: false },
  disaster: { levels: ['Red', 'Orange', 'Green', 'none'], types: ['EQ', 'TC', 'FL', 'VO', 'DR', 'WF', 'TS'] },
  natural: { types: Object.keys(NATURAL_TYPES) },
  thermal: { minConfidence: 2, sensors: null }, // high confidence only; null = all sensors
  weather: { severities: ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'] },
};

export const DEPTH_RANGES = {
  all: { label: 'All depths', min: -Infinity, max: Infinity },
  shallow: { label: 'Shallow (0–70 km)', min: -Infinity, max: 70 },
  intermediate: { label: 'Intermediate (70–300 km)', min: 70, max: 300 },
  deep: { label: 'Deep (300 km+)', min: 300, max: Infinity },
};

/** Merge stored/URL filters over defaults, ignoring unknown shapes. */
export function mergeFilters(partial) {
  const f = structuredClone(DEFAULT_FILTERS);
  if (!partial || typeof partial !== 'object') return f;
  if (typeof partial.window === 'string') f.window = partial.window;
  for (const k of ['layers', 'earthquake', 'disaster', 'natural', 'thermal', 'weather']) {
    if (partial[k] && typeof partial[k] === 'object') Object.assign(f[k], partial[k]);
  }
  return f;
}

/** Start of the selected time window (epoch ms). */
export const windowStart = (filters, now) => now - windowMinutes(filters.window) * 60_000;

export function earthquakeMatches(p, filters, now) {
  const t = parseUtc(p.eventStartUtc);
  if (t == null || t < windowStart(filters, now)) return false;
  const f = filters.earthquake;
  const mag = p.severity?.numeric;
  if (f.minMag > 0 && !(Number.isFinite(mag) && mag >= f.minMag)) return false;
  const range = DEPTH_RANGES[f.depth] || DEPTH_RANGES.all;
  const depth = p.attributes?.depthKm;
  if (f.depth !== 'all' && !(Number.isFinite(depth) && depth >= range.min && depth < range.max)) return false;
  if (f.significantOnly && !p.attributes?.significant) return false;
  return true;
}

/**
 * GDACS events are ongoing, so an event matches the time window when it was
 * active at any point inside it (start ≤ now and end ≥ window start).
 */
/**
 * Latest time the source reports the event as active: its end (GDACS latest
 * episode end, EONET closing date), else its last update, else its start.
 */
export function lastActivityMs(p) {
  return parseUtc(p.eventEndUtc) ?? parseUtc(p.sourceUpdatedUtc) ?? parseUtc(p.eventStartUtc);
}

/**
 * GDACS events match when they were active inside the selected window: an
 * event whose latest episode ended before the window starts is not shown, even
 * if the feed still lists it.
 */
export function disasterMatches(p, filters, now) {
  const start = parseUtc(p.eventStartUtc);
  const last = lastActivityMs(p);
  if (last == null || last < windowStart(filters, now)) return false;
  if (start != null && start > now + 3_600_000) return false;
  const level = p.severity?.sourceLevel || 'none';
  if (!filters.disaster.levels.includes(level)) return false;
  if (!filters.disaster.types.includes(p.subtype)) return false;
  return true;
}

/** EONET events match when last reported inside the window and their type is selected. */
export function naturalMatches(p, filters, now) {
  const last = lastActivityMs(p);
  if (last == null || last < windowStart(filters, now)) return false;
  return filters.natural.types.includes(p.subtype);
}

/**
 * NWS alerts match while they have not expired and their severity is selected.
 * Alerts with a future onset are kept: they are issued ahead of time on purpose.
 */
export function weatherMatches(p, filters, now) {
  const end = parseUtc(p.eventEndUtc);
  if (end != null && end < now) return false;
  return filters.weather.severities.includes(p.severity?.sourceLevel || 'Unknown');
}

/** Filter a FeatureCollection's features with one of the matchers above. */
export function filterFeatures(fc, matcher, filters, now) {
  if (!fc?.features) return [];
  return fc.features.filter((f) => matcher(f.properties, filters, now));
}

/** Detection row (see firms-codec ROW_FIELDS) passes thermal filters? */
export function thermalRowMatches(row, filters, now) {
  const tMs = row[2] * 60_000;
  if (tMs < windowStart(filters, now)) return false;
  if (row[4] < filters.thermal.minConfidence) return false;
  const sensors = filters.thermal.sensors;
  if (Array.isArray(sensors) && !sensors.includes(row[3])) return false;
  return true;
}

/** Highest summary age bucket included in the window (see firms-codec AGE_BUCKETS). */
export function maxAgeBucket(filters) {
  const m = windowMinutes(filters.window);
  let idx = 0;
  for (let i = 0; i < AGE_BUCKETS.length; i++) if (AGE_BUCKETS[i] <= m) idx = i;
  return idx;
}

/** Count detections in a summary cell's `counts` map that pass the filters. */
export function summaryCellCount(counts, filters) {
  const maxBucket = maxAgeBucket(filters);
  const sensors = filters.thermal.sensors;
  let n = 0;
  for (const [k, v] of Object.entries(counts)) {
    const [s, c, b] = k.split('|').map(Number);
    if (b > maxBucket) continue;
    if (c < filters.thermal.minConfidence) continue;
    if (Array.isArray(sensors) && !sensors.includes(s)) continue;
    n += v;
  }
  return n;
}

/** "High severity" as classified by the source itself (documented on the methodology page). */
export function isHighSeverity(p) {
  switch (p.category) {
    case 'earthquake':
      return Number.isFinite(p.severity?.numeric) && p.severity.numeric >= 5;
    case 'disaster':
      return ['Orange', 'Red'].includes(p.severity?.sourceLevel);
    case 'weather':
      return ['Severe', 'Extreme'].includes(p.severity?.sourceLevel);
    default:
      return false;
  }
}
