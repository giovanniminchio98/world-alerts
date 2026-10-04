// Compact encoding for NASA FIRMS thermal detections.
//
// Global satellite detections can number hundreds of thousands per week, so they
// are not published as one GeoJSON file. Instead the refresh job writes:
//   fires/index.json            – tile list, sensors, field order, counts
//   fires/summary.json          – 1° grid cells with counts (world / continental zoom)
//   fires/tiles/<x>_<y>.json    – 10° × 10° tiles with individual detections as rows
// The browser only downloads tiles that intersect the current view or selection.

export const TILE_SIZE_DEG = 10;
export const SUMMARY_CELL_DEG = 1;

/** Field order of each detection row in a tile file. */
export const ROW_FIELDS = ['lon', 'lat', 'tMin', 'sensor', 'conf', 'frp', 'bright', 'dayNight'];

export const CONFIDENCE_LABELS = ['low', 'nominal', 'high'];

/** Age buckets used in the summary grid (minutes before the generation time). */
export const AGE_BUCKETS = [60, 1440, 2880, 10080];

/**
 * Map a FIRMS confidence value to 0 (low), 1 (nominal) or 2 (high).
 * VIIRS uses l / n / h; MODIS uses 0–100 (FIRMS guidance: <30 low, 30–79 nominal, ≥80 high).
 */
export function confidenceClass(raw) {
  if (raw == null) return 1;
  const s = String(raw).trim().toLowerCase();
  if (s === 'l' || s === 'low') return 0;
  if (s === 'n' || s === 'nominal') return 1;
  if (s === 'h' || s === 'high') return 2;
  const n = Number(s);
  if (!Number.isFinite(n)) return 1;
  if (n < 30) return 0;
  if (n < 80) return 1;
  return 2;
}

/** FIRMS acq_date ("2026-10-04") + acq_time ("0135" or "135") → epoch ms (UTC). */
export function acquisitionTimeMs(acqDate, acqTime) {
  if (!acqDate) return null;
  const t = String(acqTime ?? '0').trim().padStart(4, '0');
  const ms = Date.parse(`${acqDate}T${t.slice(0, 2)}:${t.slice(2, 4)}:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

export function tileKeyFor(lon, lat, size = TILE_SIZE_DEG) {
  const x = Math.floor((Math.min(179.9999, Math.max(-180, lon)) + 180) / size);
  const y = Math.floor((Math.min(89.9999, Math.max(-90, lat)) + 90) / size);
  return `${x}_${y}`;
}

export function tileBbox(key, size = TILE_SIZE_DEG) {
  const [x, y] = key.split('_').map(Number);
  return [x * size - 180, y * size - 90, (x + 1) * size - 180, (y + 1) * size - 90];
}

/** Tile keys intersecting a [minLon, minLat, maxLon, maxLat] box (handles antimeridian). */
export function tileKeysForBbox(bbox, size = TILE_SIZE_DEG) {
  let [minLon, minLat, maxLon, maxLat] = bbox;
  minLat = Math.max(-90, minLat);
  maxLat = Math.min(89.9999, maxLat);
  const ranges = [];
  if (maxLon - minLon >= 360) ranges.push([-180, 179.9999]);
  else {
    const wrap = (v) => ((((v + 180) % 360) + 360) % 360) - 180;
    const a = wrap(minLon);
    const b = wrap(maxLon);
    if (a <= b) ranges.push([a, b]);
    else ranges.push([a, 179.9999], [-180, b]);
  }
  const keys = new Set();
  for (const [lo, hi] of ranges) {
    const x0 = Math.floor((lo + 180) / size);
    const x1 = Math.floor((hi + 180) / size);
    const y0 = Math.floor((minLat + 90) / size);
    const y1 = Math.floor((maxLat + 90) / size);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) keys.add(`${x}_${y}`);
  }
  return [...keys];
}

/** Summary-grid count key: "<sensorIndex>|<confidenceClass>|<ageBucketIndex>". */
export function summaryCountKey(sensorIdx, conf, bucketIdx) {
  return `${sensorIdx}|${conf}|${bucketIdx}`;
}

export function ageBucketIndex(ageMinutes) {
  for (let i = 0; i < AGE_BUCKETS.length; i++) if (ageMinutes <= AGE_BUCKETS[i]) return i;
  return AGE_BUCKETS.length - 1;
}

/** Decode one tile row into a detection object. */
export function decodeRow(row, sensors) {
  const [lon, lat, tMin, sensor, conf, frp, bright, dayNight] = row;
  return {
    lon,
    lat,
    timeMs: tMin * 60_000,
    sensor: sensors[sensor] ?? null,
    sensorIndex: sensor,
    confidence: conf,
    confidenceLabel: CONFIDENCE_LABELS[conf] ?? 'nominal',
    frp,
    brightness: bright,
    dayNight: dayNight === 1 ? 'night' : dayNight === 0 ? 'day' : null,
  };
}
