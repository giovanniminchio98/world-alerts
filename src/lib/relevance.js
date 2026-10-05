// Builds the "Location Status" report for a selected point. Pure function —
// it takes already-loaded data and returns structured results plus wording.
//
// Relevance rules (see the methodology page):
//  * Point incidents (earthquakes, thermal detections, point-type GDACS hazards):
//    included when within the selected radius (Haversine distance).
//  * Area incidents (NWS polygons, GDACS affected areas): included when the
//    location lies inside the published geometry.
//  * GDACS events with only a representative coordinate: included when that
//    coordinate is within the radius (labelled representative) or when the
//    source lists the location's country as affected (labelled country-level).
//  * Nothing is inferred beyond what a source publishes; absence of results is
//    reported as "no matching incidents detected", never as "safe".

import { describeSourceStatus } from '../shared/status.js';
import { geometryContainsPoint, hasAreaGeometry, haversineKm, relativePosition } from '../shared/geo.js';
import { toIsoUtc } from '../shared/time.js';
import { decodeRow } from '../shared/firms-codec.js';
import { disasterMatches, earthquakeMatches, isHighSeverity, naturalMatches, thermalRowMatches, weatherMatches } from './filters.js';

export const CATEGORY_ORDER = [
  { category: 'earthquake', sourceKey: 'usgs-earthquakes' },
  { category: 'disaster', sourceKey: 'gdacs-disasters' },
  { category: 'natural', sourceKey: 'eonet-events' },
  { category: 'weather', sourceKey: 'nws-alerts' },
  { category: 'thermal', sourceKey: 'firms-hotspots' },
  { category: 'internet', sourceKey: 'internet-outages' },
  { category: 'power', sourceKey: 'power-outages' },
  { category: 'aviation', sourceKey: 'airport-disruptions' },
  { category: 'health', sourceKey: 'health-notices' },
];

export const NO_MATCH_TEXT = 'No matching incidents detected by connected sources';
export const NO_MATCH_SUMMARY =
  'No matching incidents were detected by the connected sources for this area and selected time window.';
export const COVERAGE_NOTE =
  'Absence of a listed event does not confirm that no disruption exists. This card reflects only the sources and coverage shown below.';

const isoDefault = (ms) => toIsoUtc(ms);

/** Minimum distance (km) from a point to any vertex of a geometry — an approximation of edge distance. */
export function approxDistanceToGeometryKm(geometry, lon, lat, maxVertices = 4000) {
  let best = Infinity;
  let seen = 0;
  const visit = (c) => {
    if (seen > maxVertices) return;
    if (typeof c[0] === 'number') {
      seen++;
      const d = haversineKm(lat, lon, c[1], c[0]);
      if (d < best) best = d;
      return;
    }
    for (const x of c) visit(x);
  };
  if (geometry?.type === 'GeometryCollection') geometry.geometries.forEach((g) => visit(g.coordinates));
  else if (geometry?.coordinates) visit(geometry.coordinates);
  return best;
}

function pointItem(feature, origin) {
  const p = feature.properties;
  const pos = relativePosition(origin, feature.geometry.coordinates);
  return { feature, km: pos.km, direction: pos.direction, bearing: pos.bearing, relation: 'nearby', high: isHighSeverity(p) };
}

function matchEarthquakes(fc, sel, filters, now) {
  const origin = [sel.lon, sel.lat];
  const items = [];
  for (const f of fc?.features || []) {
    if (!earthquakeMatches(f.properties, filters, now)) continue;
    const item = pointItem(f, origin);
    if (item.km <= sel.radiusKm) items.push(item);
  }
  return items.sort((a, b) => a.km - b.km);
}

/** Shared by GDACS and EONET: area containment, point radius, representative points and country lists. */
function matchDisasters(fc, sel, filters, now, matcher = disasterMatches) {
  const origin = [sel.lon, sel.lat];
  const items = [];
  for (const f of fc?.features || []) {
    const p = f.properties;
    if (!matcher(p, filters, now)) continue;
    const base = pointItem(f, origin);
    const area = p.affectedGeometry;
    const hasArea = hasAreaGeometry(area);
    if (hasArea && geometryContainsPoint(area, origin)) {
      items.push({ ...base, relation: 'inside-area', order: 0 });
    } else if (p.locationPrecision === 'exact' && base.km <= sel.radiusKm) {
      items.push({ ...base, relation: 'nearby', order: 1 });
    } else if (hasArea) {
      // A published area is more specific than the country list, so it alone decides.
      const edgeKm = approxDistanceToGeometryKm(area, sel.lon, sel.lat);
      if (edgeKm <= sel.radiusKm) items.push({ ...base, relation: 'near-area', edgeKm, order: 2 });
    } else if (p.locationPrecision !== 'exact' && base.km <= sel.radiusKm) {
      items.push({ ...base, relation: 'representative', order: 2 });
    } else if (sel.countryCode && p.countryCodes?.includes(sel.countryCode.toUpperCase())) {
      items.push({ ...base, relation: 'country', order: 3 });
    }
  }
  return items.sort((a, b) => a.order - b.order || a.km - b.km);
}

/** e.g. "2 alerts covering this location: Extreme Heat Warning, Heat Advisory" — names the hazard up front. */
function weatherHeadline(items) {
  const names = [...new Set(items.map((i) => i.feature.properties.attributes?.event).filter(Boolean))];
  const head = `${plural(items.length, 'alert')} covering this location`;
  return names.length ? `${head}: ${names.join(', ')}` : head;
}

function matchWeather(fc, sel, filters, now) {
  const origin = [sel.lon, sel.lat];
  const items = [];
  for (const f of fc?.features || []) {
    if (!weatherMatches(f.properties, filters, now)) continue;
    if (!geometryContainsPoint(f.geometry, origin)) continue;
    items.push({ feature: f, relation: 'inside-area', high: isHighSeverity(f.properties), km: null });
  }
  return items.sort((a, b) => (b.feature.properties.severity.numeric ?? 0) - (a.feature.properties.severity.numeric ?? 0));
}

/** `thermal` = { rows, sensors } with rows from tiles covering the radius. */
function matchThermal(thermal, sel, filters, now) {
  const origin = [sel.lon, sel.lat];
  const hits = [];
  for (const row of thermal?.rows || []) {
    if (!thermalRowMatches(row, filters, now)) continue;
    const pos = relativePosition(origin, [row[0], row[1]]);
    if (pos.km <= sel.radiusKm) hits.push({ row, ...pos });
  }
  hits.sort((a, b) => a.km - b.km);
  const latestMin = hits.reduce((m, h) => Math.max(m, h.row[2]), 0);
  return {
    count: hits.length,
    highCount: hits.filter((h) => h.row[4] === 2).length,
    latestMs: latestMin ? latestMin * 60_000 : null,
    nearest: hits.slice(0, 5).map((h) => ({ ...decodeRow(h.row, thermal.sensors || []), km: h.km, direction: h.direction })),
  };
}

/** True when the selected location is inside a regional source's declared coverage. */
export function inCoverage(meta, sel) {
  if (meta?.scope !== 'regional') return true;
  const codes = meta.regionCountryCodes || [];
  return Boolean(sel.countryCode && codes.includes(sel.countryCode.toUpperCase()));
}

function freshnessNote(desc, formatTime) {
  if (desc.status === 'stale') return `Data is stale; last successful refresh was ${formatTime(desc.lastSuccessMs)}.`;
  if (desc.status === 'failed' && desc.hasData) {
    return `This source could not be refreshed. Showing last valid data from ${formatTime(desc.lastSuccessMs)}.`;
  }
  return null;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * @param {object} args
 * @param {{lon:number,lat:number,radiusKm:number,countryCode?:string}} args.selection
 * @param {object} args.datasets  { earthquake, disaster, natural, weather } FeatureCollections (or null if not loaded)
 * @param {object} args.loadErrors { earthquake: bool, ... } — data file failed to load in the browser
 * @param {object} args.thermal   { rows, sensors } or null when unavailable
 * @param {Array}  args.sources   manifest.sources
 */
export function buildLocationReport({
  selection,
  datasets = {},
  loadErrors = {},
  thermal = null,
  sources = [],
  filters,
  now = Date.now(),
  formatTime = isoDefault,
}) {
  const byKey = Object.fromEntries(sources.map((s) => [s.sourceKey || s.key, s]));
  const categories = [];
  let incidentCount = 0;
  let highCount = 0;
  let thermalCount = 0;
  let degraded = 0;

  for (const { category, sourceKey } of CATEGORY_ORDER) {
    const meta = byKey[sourceKey];
    if (!meta) continue;
    const desc = describeSourceStatus(meta, now);
    const row = {
      category,
      sourceKey,
      label: meta.categoryLabel || category,
      sourceName: meta.shortName || meta.name,
      meta,
      status: desc.status,
      items: [],
      thermal: null,
      state: 'none',
      headline: NO_MATCH_TEXT,
      freshness: null,
      note: null,
    };

    if (desc.status === 'unavailable') {
      row.state = 'not-connected';
      row.headline = meta.unavailableMessage || 'No data source is currently connected for this category.';
      categories.push(row);
      continue;
    }
    if (!inCoverage(meta, selection)) {
      row.state = 'coverage-unavailable';
      row.headline = 'Coverage unavailable for this area';
      row.note = meta.coverage || null;
      categories.push(row);
      continue;
    }
    if (category === 'weather' && filters.layers?.weather === false) {
      row.state = 'layer-off';
      row.headline = 'Layer turned off — switch on “Weather alerts” in Layers & filters to include NWS alerts here.';
      categories.push(row);
      continue;
    }
    const data = category === 'thermal' ? thermal : datasets[category];
    if ((desc.status === 'failed' && !desc.hasData) || loadErrors[category] || data == null) {
      row.state = 'source-unavailable';
      row.headline = 'Source temporarily unavailable — no data currently available.';
      degraded++;
      categories.push(row);
      continue;
    }
    row.freshness = freshnessNote(desc, formatTime);
    if (row.freshness) degraded++;

    if (category === 'thermal') {
      row.thermal = matchThermal(thermal, selection, filters, now);
      thermalCount = row.thermal.count;
      if (row.thermal.count) {
        row.state = 'found';
        row.headline = `${plural(row.thermal.count, 'heat spot')} seen by satellite — possible fires, crop burning or industrial heat`;
      }
    } else {
      if (category === 'earthquake') row.items = matchEarthquakes(data, selection, filters, now);
      else if (category === 'disaster') row.items = matchDisasters(data, selection, filters, now);
      else if (category === 'natural') row.items = matchDisasters(data, selection, filters, now, naturalMatches);
      else if (category === 'weather') row.items = matchWeather(data, selection, filters, now);
      if (row.items.length) {
        row.state = 'found';
        row.headline = category === 'weather' ? weatherHeadline(row.items) : `${plural(row.items.length, 'relevant event')} found`;
        incidentCount += row.items.length;
        highCount += row.items.filter((i) => i.high).length;
      }
    }
    categories.push(row);
  }

  const r = selection.radiusKm;
  const lines = [];
  if (incidentCount === 0 && thermalCount === 0) {
    lines.push(NO_MATCH_SUMMARY);
  } else {
    if (incidentCount > 0) {
      lines.push(`${plural(incidentCount, 'monitored incident')} found within ${r} km or covering this location during the selected time window.`);
      lines.push(
        highCount > 0
          ? `${highCount} of them ${highCount === 1 ? 'carries' : 'carry'} a high-severity classification from ${highCount === 1 ? 'its' : 'their'} source.`
          : `No high-severity incidents from currently connected sources were found within ${r} km during the selected time window.`,
      );
    } else {
      lines.push(`No monitored incidents (earthquakes, disaster alerts, natural events or weather alerts) were found within ${r} km during the selected time window.`);
    }
    if (thermalCount > 0) {
      lines.push(`${plural(thermalCount, 'heat spot')} seen by satellite within ${r} km — possible fires, crop burning or industrial heat, not necessarily wildfires.`);
    }
  }
  if (degraded > 0) lines.push('Some sources are stale or unavailable; see the category rows below.');

  return {
    generatedAt: now,
    selection,
    incidentCount,
    highCount,
    thermalCount,
    summaryLines: lines,
    coverageNote: COVERAGE_NOTE,
    categories,
  };
}
