// NASA FIRMS — satellite active-fire / thermal hotspot detections.
//
// Two fetch modes:
//  * FIRMS_MAP_KEY set (GitHub Actions secret): the FIRMS area API.
//  * no key: the public FIRMS "active_fire" global 7-day CSV text files.
// The key is only ever used inside GitHub Actions and is redacted from logs.
//
// Output is tiled (see src/shared/firms-codec.js) so browsers only download
// the detections they need.

import { parseCsvObjects } from '../lib/csv.js';
import { registerSecret } from '../lib/http.js';
import { toIsoUtc } from '../../src/shared/time.js';
import { round } from '../../src/shared/geo.js';
import {
  AGE_BUCKETS,
  ROW_FIELDS,
  SUMMARY_CELL_DEG,
  TILE_SIZE_DEG,
  acquisitionTimeMs,
  ageBucketIndex,
  confidenceClass,
  summaryCountKey,
  tileKeyFor,
} from '../../src/shared/firms-codec.js';

export const key = 'firms-hotspots';

/** Supported FIRMS products, their display label and public 7-day file. */
export const PRODUCTS = {
  VIIRS_NOAA20_NRT: {
    label: 'VIIRS (NOAA-20)',
    publicUrl: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_7d.csv',
  },
  VIIRS_NOAA21_NRT: {
    label: 'VIIRS (NOAA-21)',
    publicUrl: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_7d.csv',
  },
  VIIRS_SNPP_NRT: {
    label: 'VIIRS (Suomi NPP)',
    publicUrl: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_7d.csv',
  },
  MODIS_NRT: {
    label: 'MODIS (Terra/Aqua)',
    publicUrl: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_7d.csv',
  },
};

const WINDOW_MINUTES = 7 * 24 * 60;
const DEFAULT_MAX = 300_000;

export function configuredProducts() {
  const list = (process.env.FIRMS_PRODUCTS || 'VIIRS_NOAA20_NRT,MODIS_NRT')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => PRODUCTS[s]);
  return list.length ? list : ['VIIRS_NOAA20_NRT'];
}

const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

export async function fetchRaw(ctx) {
  const mapKey = process.env.FIRMS_MAP_KEY?.trim();
  if (mapKey) registerSecret(mapKey);
  const products = configuredProducts();
  const parts = [];
  for (const product of products) {
    if (mapKey) {
      // The area API serves at most a few days per request, so request the most
      // recent 5 days plus the 2 days before that to cover the 7-day window.
      const base = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/${product}/world`;
      const recent = await ctx.fetchText(`${base}/5`, { timeoutMs: 180_000 });
      const older = await ctx.fetchText(`${base}/2/${isoDate(ctx.now - 6 * 86_400_000)}`, { timeoutMs: 180_000 });
      for (const body of [recent, older]) {
        if (!/^\s*latitude,/i.test(body)) throw new Error(`FIRMS API did not return CSV for ${product} (check FIRMS_MAP_KEY)`);
      }
      parts.push({ product, csv: [recent, older] });
    } else {
      const csv = await ctx.fetchText(PRODUCTS[product].publicUrl, { timeoutMs: 300_000 });
      parts.push({ product, csv: [csv] });
    }
  }
  return { mode: mapKey ? 'api' : 'public-files', parts };
}

export function normalize(raw, ctx) {
  const now = ctx.now;
  const windowStart = now - WINDOW_MINUTES * 60_000;
  const max = Number(process.env.FIRMS_MAX_DETECTIONS) || DEFAULT_MAX;
  const sensors = [];
  const detections = [];
  const seen = new Set();
  let parsedRows = 0;

  for (const part of raw.parts) {
    const label = PRODUCTS[part.product]?.label || part.product;
    let sensorIdx = sensors.indexOf(label);
    if (sensorIdx === -1) sensorIdx = sensors.push(label) - 1;
    for (const csv of part.csv) {
      const rows = parseCsvObjects(csv);
      if (rows.length && !('latitude' in rows[0])) throw new Error(`FIRMS ${part.product} CSV has no latitude column`);
      for (const r of rows) {
        parsedRows++;
        const lat = Number(r.latitude);
        const lon = Number(r.longitude);
        const t = acquisitionTimeMs(r.acq_date, r.acq_time);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || t == null) continue;
        if (t < windowStart || t > now + 3_600_000) continue;
        const rlon = round(lon, 4);
        const rlat = round(lat, 4);
        const tMin = Math.round(t / 60_000);
        const dedupe = `${sensorIdx}|${rlon}|${rlat}|${tMin}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        const bright = Number(r.bright_ti4 ?? r.brightness);
        const frp = Number(r.frp);
        detections.push([
          rlon,
          rlat,
          tMin,
          sensorIdx,
          confidenceClass(r.confidence),
          Number.isFinite(frp) ? round(frp, 1) : null,
          Number.isFinite(bright) ? round(bright, 1) : null,
          r.daynight === 'N' ? 1 : r.daynight === 'D' ? 0 : null,
        ]);
      }
    }
  }
  if (parsedRows === 0) throw new Error('FIRMS returned no rows');

  // Keep the newest / highest-confidence detections if the global volume exceeds the cap.
  let truncated = false;
  if (detections.length > max) {
    detections.sort((a, b) => b[4] - a[4] || b[2] - a[2]);
    detections.length = max;
    truncated = true;
  }

  const tiles = new Map();
  const cells = new Map();
  const nowMin = Math.round(now / 60_000);
  let newest = 0;
  for (const d of detections) {
    const [lon, lat, tMin, s, conf, frp] = d;
    if (tMin > newest) newest = tMin;
    const tk = tileKeyFor(lon, lat);
    if (!tiles.has(tk)) tiles.set(tk, []);
    tiles.get(tk).push(d);

    const ck = `${Math.floor(lon / SUMMARY_CELL_DEG)}:${Math.floor(lat / SUMMARY_CELL_DEG)}`;
    let cell = cells.get(ck);
    if (!cell) {
      cell = { sumLon: 0, sumLat: 0, n: 0, latest: 0, maxFrp: 0, counts: {} };
      cells.set(ck, cell);
    }
    cell.sumLon += lon;
    cell.sumLat += lat;
    cell.n++;
    if (tMin > cell.latest) cell.latest = tMin;
    if (frp != null && frp > cell.maxFrp) cell.maxFrp = frp;
    const ckey = summaryCountKey(s, conf, ageBucketIndex(nowMin - tMin));
    cell.counts[ckey] = (cell.counts[ckey] || 0) + 1;
  }

  const sortRows = (a, b) => b[2] - a[2] || a[0] - b[0] || a[1] - b[1] || a[3] - b[3];
  const files = {};
  const tileCounts = {};
  for (const tk of [...tiles.keys()].sort()) {
    const rows = tiles.get(tk).sort(sortRows);
    tileCounts[tk] = rows.length;
    files[`fires/tiles/${tk}.json`] = { tile: tk, rows };
  }
  const summaryRows = [...cells.values()]
    .map((c) => [
      round(c.sumLon / c.n, 2),
      round(c.sumLat / c.n, 2),
      c.latest,
      round(c.maxFrp, 1),
      Object.fromEntries(Object.entries(c.counts).sort(([a], [b]) => (a < b ? -1 : 1))),
    ])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const common = {
    generatedUtc: ctx.nowIso,
    windowStartUtc: toIsoUtc(windowStart),
    windowEndUtc: ctx.nowIso,
    sensors,
  };
  files['fires/summary.json'] = {
    ...common,
    cellSizeDeg: SUMMARY_CELL_DEG,
    rowFields: ['lon', 'lat', 'latestMin', 'maxFrp', 'counts'],
    countKey: 'sensorIndex|confidenceClass|ageBucketIndex',
    ageBucketsMinutes: AGE_BUCKETS,
    rows: summaryRows,
  };
  files['fires/index.json'] = {
    ...common,
    sourceKey: key,
    fetchMode: raw.mode,
    products: raw.parts.map((p) => p.product),
    tileSizeDeg: TILE_SIZE_DEG,
    rowFields: ROW_FIELDS,
    confidenceClasses: ['low', 'nominal', 'high'],
    total: detections.length,
    truncated,
    tiles: tileCounts,
    disclaimer:
      'Satellite thermal detections are not confirmed wildfires. They can include agricultural burning, industrial heat sources, gas flares or other thermal anomalies.',
  };

  return {
    records: detections.length,
    minExpectedRecords: 1,
    sourceLatestDataTimeUtc: newest ? toIsoUtc(newest * 60_000) : null,
    sourceLastEventTimeUtc: newest ? toIsoUtc(newest * 60_000) : null,
    notes: truncated ? `Detections were capped at ${max.toLocaleString('en-US')}; lower-confidence and older detections were omitted.` : null,
    replaceDirs: ['fires/tiles'],
    files,
  };
}
