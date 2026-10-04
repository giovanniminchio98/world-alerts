// GDACS — Global Disaster Alert and Coordination System.
// Primary: GeoJSON event list (MAP). Fallback: the public GeoRSS feed.

import countries from 'i18n-iso-countries';
import { makeIncident, sortIncidents } from '../../src/shared/schema.js';
import { parseUtc, toIsoUtc } from '../../src/shared/time.js';
import { geometryBbox, mergePolygons, round, simplifyGeometry } from '../../src/shared/geo.js';
import { GDACS_POINT_HAZARDS, GDACS_TYPES, gdacsColorHint } from '../../src/shared/severity.js';

export const key = 'gdacs-disasters';
const JSON_URL = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP';
const RSS_URL = 'https://www.gdacs.org/xml/rss.xml';

/** Events whose end date is older than this are dropped (unless flagged current). */
const MAX_AGE_DAYS = 14;

export async function fetchRaw(ctx) {
  try {
    const json = await ctx.fetchJson(process.env.GDACS_JSON_URL || JSON_URL, { timeoutMs: 90_000 });
    if (json?.type === 'FeatureCollection') return { format: 'geojson', data: json };
    throw new Error('GDACS JSON response was not a FeatureCollection');
  } catch (e) {
    ctx.log(`  GDACS JSON failed (${e.message}); trying GeoRSS fallback`);
    const xml = await ctx.fetchText(process.env.GDACS_RSS_URL || RSS_URL, { timeoutMs: 90_000 });
    return { format: 'rss', data: xml };
  }
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

export function normalize(raw, ctx) {
  const fetchedUtc = ctx.nowIso;
  let features;
  if (raw.format === 'geojson') features = normalizeGeoJson(raw.data, fetchedUtc, ctx.now);
  else if (raw.format === 'rss') features = normalizeRss(raw.data, fetchedUtc, ctx.now);
  else throw new Error('Unknown GDACS payload format');
  features = sortIncidents(features.filter((f) => keepRecent(f, ctx.now)));
  const latestModified = features
    .map((f) => parseUtc(f.properties.sourceUpdatedUtc))
    .filter((v) => v != null)
    .sort((a, b) => b - a)[0];
  return {
    records: features.length,
    minExpectedRecords: 0,
    sourceLatestDataTimeUtc: toIsoUtc(latestModified) ?? null,
    sourceLastEventTimeUtc: features[0]?.properties.eventStartUtc ?? null,
    notes: raw.format === 'rss' ? 'Fetched from the GDACS GeoRSS fallback feed (no affected-area polygons).' : null,
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
    },
  };
}
