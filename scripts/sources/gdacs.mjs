// GDACS — Global Disaster Alert and Coordination System.
//
// Event list: tries the documented GDACS JSON endpoints in turn (SEARCH,
// EVENTS4APP, MAP) and falls back to the public GeoRSS feed. Affected areas
// (flood extents, cyclone wind buffers, burnt areas, shake zones) come from
// the GDACS geometry endpoint, fetched per event and cached in
// cache/gdacs-geometry.json so each run only requests new episodes.

import countries from 'i18n-iso-countries';
import { makeIncident, sortIncidents } from '../../src/shared/schema.js';
import { parseUtc, toIsoUtc } from '../../src/shared/time.js';
import { geometryBbox, mergePolygons, round, simplifyGeometry } from '../../src/shared/geo.js';
import { GDACS_POINT_HAZARDS, GDACS_TYPES, gdacsColorHint } from '../../src/shared/severity.js';
import { mapLimit } from '../lib/http.js';

export const key = 'gdacs-disasters';
const API = 'https://www.gdacs.org/gdacsapi/api';
const RSS_URL = 'https://www.gdacs.org/xml/rss.xml';
const GEOMETRY_CACHE = 'cache/gdacs-geometry.json';
const GEOMETRY_TYPES = new Set(['FL', 'TC', 'WF', 'DR', 'EQ', 'VO']);

/** Events whose end date is older than this are dropped (unless flagged current). */
const MAX_AGE_DAYS = 14;

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** JSON event-list endpoints to try, most complete first. */
function listEndpoints(now) {
  if (process.env.GDACS_JSON_URL) return [{ name: 'custom', urls: [process.env.GDACS_JSON_URL] }];
  const search = (page) =>
    `${API}/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF&fromDate=${isoDay(now - 21 * 86_400_000)}&toDate=${isoDay(now + 86_400_000)}&alertlevel=Green;Orange;Red&pagesize=100&pagenumber=${page}`;
  return [
    { name: 'SEARCH', urls: [1, 2, 3, 4, 5].map(search) },
    { name: 'EVENTS4APP', urls: [`${API}/events/geteventlist/EVENTS4APP`] },
    { name: 'MAP', urls: [`${API}/events/geteventlist/MAP`] },
  ];
}

async function fetchEventList(ctx) {
  for (const ep of listEndpoints(ctx.now)) {
    try {
      const features = [];
      for (const url of ep.urls) {
        const json = await ctx.fetchJson(url, { timeoutMs: 90_000, retries: 1 });
        if (json?.type !== 'FeatureCollection' || !Array.isArray(json.features)) throw new Error('not a FeatureCollection');
        features.push(...json.features);
        if (json.features.length < 100) break; // last page
      }
      if (!features.length) throw new Error('no events');
      ctx.log(`  GDACS event list from ${ep.name}: ${features.length} features`);
      return { format: 'geojson', endpoint: ep.name, data: { type: 'FeatureCollection', features } };
    } catch (e) {
      ctx.log(`  GDACS ${ep.name} failed (${e.message})`);
    }
  }
  const xml = await ctx.fetchText(process.env.GDACS_RSS_URL || RSS_URL, { timeoutMs: 90_000 });
  ctx.log('  GDACS event list from the GeoRSS fallback');
  return { format: 'rss', endpoint: 'RSS', data: xml };
}

/** Events (type, id, episode, alert level, geometry URL) found in either list format. */
export function listEventRefs(raw) {
  const refs = new Map();
  const add = (p) => {
    const type = String(p.eventtype || '').toUpperCase();
    const id = p.eventid ?? p.id;
    if (!GEOMETRY_TYPES.has(type) || id == null) return;
    const episode = p.episodeid ?? '';
    const k = geometryKey(type, id, episode);
    if (!refs.has(k)) refs.set(k, { key: k, type, id, episode, level: String(p.alertlevel || ''), url: typeof p.url === 'object' ? p.url?.geometry : null });
  };
  if (raw.format === 'geojson') for (const f of raw.data.features || []) add(f.properties || {});
  else for (const item of String(raw.data).match(/<item[\s>][\s\S]*?<\/item>/gi) || []) {
    add({ eventtype: tag(item, 'gdacs:eventtype'), eventid: tag(item, 'gdacs:eventid'), episodeid: tag(item, 'gdacs:episodeid'), alertlevel: tag(item, 'gdacs:alertlevel') });
  }
  return [...refs.values()];
}

export const geometryKey = (type, id, episode) => `${type}:${id}:${episode ?? ''}`;

/** Polygons (minus forecast cones) and lines from a GDACS geometry response, simplified. */
export function parseGeometryResponse(json) {
  const polygons = [];
  const lines = [];
  for (const f of json?.features || []) {
    const g = f?.geometry;
    const cls = String(f?.properties?.Class || f?.properties?.class || '');
    if (!g) continue;
    if ((g.type === 'Polygon' || g.type === 'MultiPolygon') && !/cone/i.test(cls)) {
      // Simplify relative to the area's size: a Europe-wide drought does not
      // need street-level detail, a local flood keeps its shape.
      const b = geometryBbox(g);
      const diag = b ? Math.hypot(b[2] - b[0], b[3] - b[1]) : 1;
      const tolerance = Math.min(0.25, Math.max(0.01, diag / 300));
      const s = simplifyGeometry(g, tolerance, tolerance >= 0.05 ? 2 : 3);
      if (s) polygons.push(s);
    } else if (g.type === 'LineString' || g.type === 'MultiLineString') {
      lines.push(g.type === 'LineString' ? simplifyGeometry(g, 0.02, 3) : g);
    }
  }
  return { polygons, lines };
}

export async function fetchRaw(ctx) {
  const raw = await fetchEventList(ctx);
  // Affected-area geometry, newest episodes first, Red/Orange before Green; cached between runs.
  const cache = (await ctx.readPrevious(GEOMETRY_CACHE))?.events || {};
  const rank = { red: 0, orange: 1, green: 2 };
  const wanted = listEventRefs(raw)
    .filter((r) => !cache[r.key])
    .sort((a, b) => (rank[a.level.toLowerCase()] ?? 3) - (rank[b.level.toLowerCase()] ?? 3));
  const max = Number(process.env.GDACS_MAX_GEOMETRY_FETCHES) || 150;
  let fetched = 0;
  let failed = 0;
  await mapLimit(wanted.slice(0, max), 3, async (r) => {
    const url = r.url || `${API}/polygons/getgeometry?eventtype=${r.type}&eventid=${r.id}&episodeid=${r.episode}`;
    try {
      const json = await ctx.fetchJson(url, { timeoutMs: 60_000, retries: 1 });
      cache[r.key] = { ...parseGeometryResponse(json), fetchedUtc: ctx.nowIso };
      fetched++;
    } catch {
      failed++;
    }
  });
  if (wanted.length) ctx.log(`  GDACS geometry: fetched ${fetched}, failed ${failed}, deferred ${Math.max(0, wanted.length - max)}`);
  return { ...raw, geometries: cache };
}

const alpha2 = (code) => {
  if (!code) return null;
  const c = String(code).trim().toUpperCase();
  if (c.length === 2) return c;
  if (c.length === 3) return countries.alpha3ToAlpha2(c) || null;
  return null;
};

const stripHtml = (s) => (s ? String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '');

const truthy = (v) => v === true || String(v).toLowerCase() === 'true';

function countryCodesFrom(p) {
  const codes = new Set();
  for (const c of p.affectedcountries || []) {
    const code = alpha2(c.iso2) || alpha2(c.iso3);
    if (code) codes.add(code);
  }
  for (const iso of String(p.iso3 || '').split(/[,;\s]+/)) {
    const code = alpha2(iso);
    if (code) codes.add(code);
  }
  return [...codes].sort();
}

/**
 * Build one normalised incident from a GDACS event. `point` is the source's
 * representative coordinate (may be null), `polygons` / `lines` any affected
 * area or track geometry the source published for the same event.
 */
function buildIncident({ p, point, polygons = [], lines = [], fetchedUtc, now }) {
  const type = String(p.eventtype || '').toUpperCase();
  const typeLabel = GDACS_TYPES[type] || 'Disaster';
  const level = p.alertlevel || p.episodealertlevel || null;
  const affected = mergePolygons(polygons.map((g) => simplifyGeometry(g, 0.01, 3)));
  const track = lines.length
    ? { type: 'MultiLineString', coordinates: lines.flatMap((l) => (l.type === 'LineString' ? [l.coordinates] : l.coordinates)) }
    : null;

  let coords = point;
  let precision;
  if (!coords && affected) {
    const b = geometryBbox(affected);
    coords = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  }
  if (!coords) return null;
  if (GDACS_POINT_HAZARDS.has(type)) precision = 'exact';
  else precision = affected ? 'area' : 'representative';

  const sev = p.severitydata || {};
  const countryText = p.country || (p.affectedcountries || []).map((c) => c.countryname).filter(Boolean).join(', ') || null;
  const name = p.name || p.eventname || `${typeLabel}${countryText ? ` in ${countryText}` : ''}`;
  const eventId = p.eventid ?? p.id;
  const reportUrl =
    (typeof p.url === 'object' ? p.url?.report : p.url) ||
    `https://www.gdacs.org/report.aspx?eventtype=${type}&eventid=${eventId}`;

  return makeIncident({
    id: `gdacs:${type}:${eventId}`,
    source: 'GDACS',
    sourceKey: key,
    sourceUrl: reportUrl,
    category: 'disaster',
    subtype: type,
    title: name,
    summary: stripHtml(p.description) || sev.severitytext || `${typeLabel} alert`,
    severity: {
      label: level ? `${level} alert` : 'Alert level not supplied',
      numeric: Number.isFinite(Number(p.alertscore)) ? Number(p.alertscore) : null,
      sourceLevel: level,
      colorHint: gdacsColorHint(level),
    },
    geometry: { type: 'Point', coordinates: [round(coords[0], 4), round(coords[1], 4)] },
    affectedGeometry: affected,
    locationPrecision: precision,
    eventStartUtc: toIsoUtc(p.fromdate),
    eventEndUtc: toIsoUtc(p.todate),
    sourceUpdatedUtc: toIsoUtc(p.datemodified) ?? toIsoUtc(p.pubDate),
    fetchedUtc,
    countryCodes: countryCodesFrom(p),
    regionText: countryText,
    attributes: {
      hazardType: type,
      hazardLabel: typeLabel,
      alertLevel: level,
      alertScore: Number.isFinite(Number(p.alertscore)) ? Number(p.alertscore) : null,
      episodeId: p.episodeid ?? null,
      severityText: sev.severitytext || null,
      severityValue: Number.isFinite(Number(sev.severity)) ? Number(sev.severity) : null,
      severityUnit: sev.severityunit || null,
      populationText: p.populationtext || p.population?.text || null,
      isCurrent: p.iscurrent == null ? null : truthy(p.iscurrent),
      isTemporary: p.istemporary == null ? null : truthy(p.istemporary),
      glide: p.glide || null,
      track,
    },
    disclaimer:
      precision === 'representative'
        ? 'Representative event location — affected area may be broader. GDACS assessments can change as events evolve.'
        : 'GDACS is an alert and coordination source; assessments can change as events evolve.',
    attribution: 'GDACS',
    status: eventStatus(p, now),
  });
}

/** GDACS marks ongoing events with iscurrent; without the flag, treat events that ended over 3 days ago as past. */
function eventStatus(p, now) {
  if (p.iscurrent != null && p.iscurrent !== '') return truthy(p.iscurrent) ? 'active' : 'past';
  const end = parseUtc(p.todate) ?? parseUtc(p.fromdate);
  return end != null && now - end > 3 * 86_400_000 ? 'past' : 'active';
}

function keepRecent(incident, now) {
  if (incident.properties.attributes.isCurrent === true) return true;
  const end = parseUtc(incident.properties.eventEndUtc) ?? parseUtc(incident.properties.eventStartUtc);
  return end != null && now - end <= MAX_AGE_DAYS * 86_400_000;
}

/** Group the GDACS MAP FeatureCollection (points + polygons + tracks) by event. */
export function normalizeGeoJson(fc, fetchedUtc, now) {
  const groups = new Map();
  for (const f of fc.features || []) {
    const p = f.properties || {};
    const type = String(p.eventtype || '').toUpperCase();
    const id = p.eventid ?? p.id;
    if (!type || id == null || !f.geometry) continue;
    const k = `${type}:${id}`;
    if (!groups.has(k)) groups.set(k, { p: null, points: [], polygons: [], lines: [] });
    const g = groups.get(k);
    const geom = f.geometry;
    if (geom.type === 'Point') {
      g.points.push({ coords: geom.coordinates, cls: String(p.Class || p.class || ''), p });
    } else if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
      g.polygons.push(geom);
      if (!g.p) g.p = p;
    } else if (geom.type === 'LineString' || geom.type === 'MultiLineString') {
      g.lines.push(geom);
      if (!g.p) g.p = p;
    }
  }
  const out = [];
  for (const g of groups.values()) {
    const preferred = g.points.find((x) => /centroid/i.test(x.cls)) || g.points[0];
    const p = preferred?.p || g.p;
    if (!p) continue;
    const point = preferred ? [Number(preferred.coords[0]), Number(preferred.coords[1])] : null;
    const incident = buildIncident({ p, point, polygons: g.polygons, lines: g.lines, fetchedUtc, now });
    if (incident) out.push(incident);
  }
  return out;
}

// --- GeoRSS fallback -------------------------------------------------------

const decodeXml = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .trim();

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeXml(m[1]) : null;
}

function tagAttr(xml, name, attr) {
  const m = xml.match(new RegExp(`<${name}\\s[^>]*${attr}="([^"]*)"`, 'i'));
  return m ? decodeXml(m[1]) : null;
}

export function normalizeRss(xml, fetchedUtc, now) {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  const out = [];
  for (const item of items) {
    const num = (v) => (v == null || v === '' ? NaN : Number(v));
    let lat = num(tag(item, 'geo:lat'));
    let lon = num(tag(item, 'geo:long'));
    const gp = tag(item, 'georss:point');
    if ((!Number.isFinite(lat) || !Number.isFinite(lon)) && gp) [lat, lon] = gp.split(/\s+/).map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const p = {
      eventtype: tag(item, 'gdacs:eventtype'),
      eventid: tag(item, 'gdacs:eventid'),
      episodeid: tag(item, 'gdacs:episodeid'),
      alertlevel: tag(item, 'gdacs:alertlevel'),
      alertscore: tag(item, 'gdacs:alertscore'),
      name: tag(item, 'title'),
      description: tag(item, 'description')?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      fromdate: tag(item, 'gdacs:fromdate'),
      todate: tag(item, 'gdacs:todate'),
      datemodified: tag(item, 'gdacs:datemodified'),
      pubDate: tag(item, 'pubDate'),
      country: tag(item, 'gdacs:country'),
      iso3: tag(item, 'gdacs:iso3'),
      iscurrent: tag(item, 'gdacs:iscurrent'),
      istemporary: tag(item, 'gdacs:temporary'),
      glide: tag(item, 'gdacs:glide'),
      url: tag(item, 'link'),
      severitydata: {
        severitytext: tag(item, 'gdacs:severity'),
        severity: tagAttr(item, 'gdacs:severity', 'value'),
        severityunit: tagAttr(item, 'gdacs:severity', 'unit'),
      },
      populationtext: tag(item, 'gdacs:population'),
    };
    if (!p.eventtype || !p.eventid) continue;
    const incident = buildIncident({ p, point: [lon, lat], fetchedUtc, now });
    if (incident) out.push(incident);
  }
  return out;
}

/** Attach cached affected-area geometry to an incident that has none of its own. */
function enrich(incident, geometries) {
  const p = incident.properties;
  const [, type, id] = p.id.split(':');
  const geo = geometries?.[geometryKey(type, id, p.attributes.episodeId ?? '')];
  if (!geo) return incident;
  if (!p.affectedGeometry && geo.polygons?.length) {
    p.affectedGeometry = mergePolygons(geo.polygons);
    if (!GDACS_POINT_HAZARDS.has(type)) {
      p.locationPrecision = 'area';
      p.disclaimer = 'GDACS is an alert and coordination source; assessments can change as events evolve.';
    }
  }
  if (!p.attributes.track && geo.lines?.length) {
    p.attributes.track = { type: 'MultiLineString', coordinates: geo.lines.flatMap((l) => (l.type === 'LineString' ? [l.coordinates] : l.coordinates)) };
  }
  return incident;
}

export function normalize(raw, ctx) {
  const fetchedUtc = ctx.nowIso;
  let features;
  if (raw.format === 'geojson') features = normalizeGeoJson(raw.data, fetchedUtc, ctx.now);
  else if (raw.format === 'rss') features = normalizeRss(raw.data, fetchedUtc, ctx.now);
  else throw new Error('Unknown GDACS payload format');
  features = sortIncidents(features.filter((f) => keepRecent(f, ctx.now)).map((f) => enrich(f, raw.geometries)));

  // Keep the geometry cache bounded to events still listed (or fetched in the last 30 days).
  const listed = new Set(features.map((f) => {
    const [, t, i] = f.properties.id.split(':');
    return geometryKey(t, i, f.properties.attributes.episodeId ?? '');
  }));
  const cache = {};
  for (const [k, v] of Object.entries(raw.geometries || {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (listed.has(k) || ctx.now - (parseUtc(v.fetchedUtc) ?? 0) < 30 * 86_400_000) cache[k] = v;
  }
  const withArea = features.filter((f) => f.properties.affectedGeometry).length;
  const latestModified = features
    .map((f) => parseUtc(f.properties.sourceUpdatedUtc))
    .filter((v) => v != null)
    .sort((a, b) => b - a)[0];
  return {
    records: features.length,
    minExpectedRecords: 0,
    sourceLatestDataTimeUtc: toIsoUtc(latestModified) ?? null,
    sourceLastEventTimeUtc: features[0]?.properties.eventStartUtc ?? null,
    notes: `Event list from ${raw.endpoint || raw.format}; ${withArea} of ${features.length} events have a published affected area.`,
    files: {
      [`incidents/${key}.json`]: {
        type: 'FeatureCollection',
        sourceKey: key,
        fetchedUtc,
        feedFormat: raw.format,
        disclaimer:
          'GDACS alert levels are model-based estimates of potential humanitarian impact and may change as assessments evolve.',
        features,
      },
      [GEOMETRY_CACHE]: { events: cache },
    },
  };
}
