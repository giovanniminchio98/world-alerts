// Normalised incident schema + validation used before anything is published.
//
// Every incident file is a GeoJSON FeatureCollection. Each Feature carries the
// project's standard incident record in `properties`:
// {
//   id, source, sourceKey, sourceUrl, category, subtype, title, summary,
//   severity: { label, numeric, sourceLevel, colorHint },
//   affectedGeometry,            // optional Polygon/MultiPolygon/LineString
//   locationPrecision,           // "exact" | "representative" | "area"
//   eventStartUtc, eventEndUtc, sourceUpdatedUtc, fetchedUtc,
//   countryCodes, regionText, attributes, disclaimer, attribution, status
// }

import { parseUtc } from './time.js';

export const CATEGORIES = ['earthquake', 'disaster', 'thermal', 'weather', 'internet', 'power', 'aviation', 'health'];
const GEOMETRY_TYPES = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection'];

function validPosition(p) {
  return (
    Array.isArray(p) &&
    p.length >= 2 &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1]) &&
    p[0] >= -540 &&
    p[0] <= 540 &&
    p[1] >= -90 &&
    p[1] <= 90
  );
}

function validCoords(coords, depth) {
  if (depth === 0) return validPosition(coords);
  return Array.isArray(coords) && coords.length > 0 && coords.every((c) => validCoords(c, depth - 1));
}

export function validateGeometry(g) {
  if (g === null) return true;
  if (!g || !GEOMETRY_TYPES.includes(g.type)) return false;
  switch (g.type) {
    case 'Point':
      return validPosition(g.coordinates);
    case 'MultiPoint':
    case 'LineString':
      return validCoords(g.coordinates, 1);
    case 'MultiLineString':
    case 'Polygon':
      return validCoords(g.coordinates, 2);
    case 'MultiPolygon':
      return validCoords(g.coordinates, 3);
    case 'GeometryCollection':
      return Array.isArray(g.geometries) && g.geometries.every(validateGeometry);
    default:
      return false;
  }
}

const isTime = (v) => v == null || parseUtc(v) != null;
const isUrl = (v) => v == null || /^https?:\/\//.test(v);

/** Validate one incident feature. Returns a list of problems (empty = valid). */
export function validateIncident(feature) {
  const errors = [];
  if (!feature || feature.type !== 'Feature') return ['not a GeoJSON Feature'];
  const p = feature.properties;
  if (!p || typeof p !== 'object') return ['missing properties'];
  if (typeof p.id !== 'string' || !p.id) errors.push('id must be a non-empty string');
  if (feature.id !== p.id) errors.push('feature.id must equal properties.id');
  if (!CATEGORIES.includes(p.category)) errors.push(`unknown category "${p.category}"`);
  if (typeof p.title !== 'string' || !p.title) errors.push('title must be a non-empty string');
  if (typeof p.source !== 'string') errors.push('source must be a string');
  if (!validateGeometry(feature.geometry) || feature.geometry === null) errors.push('invalid geometry');
  if (p.affectedGeometry != null && !validateGeometry(p.affectedGeometry)) errors.push('invalid affectedGeometry');
  for (const key of ['eventStartUtc', 'eventEndUtc', 'sourceUpdatedUtc', 'fetchedUtc']) {
    if (!isTime(p[key])) errors.push(`${key} is not a valid time`);
  }
  if (!isUrl(p.sourceUrl)) errors.push('sourceUrl must be http(s)');
  if (!p.severity || typeof p.severity !== 'object') errors.push('severity object required');
  if (!Array.isArray(p.countryCodes)) errors.push('countryCodes must be an array');
  return errors;
}

/**
 * Validate an incident FeatureCollection. Returns `{ valid, errors }`, where
 * errors are prefixed with the feature index. Duplicate ids are errors.
 */
export function validateIncidentCollection(fc, { maxErrors = 20 } = {}) {
  const errors = [];
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    return { valid: false, errors: ['not a GeoJSON FeatureCollection'] };
  }
  const seen = new Set();
  fc.features.forEach((f, i) => {
    if (errors.length >= maxErrors) return;
    for (const e of validateIncident(f)) errors.push(`feature ${i}: ${e}`);
    const id = f?.properties?.id;
    if (seen.has(id)) errors.push(`feature ${i}: duplicate id ${id}`);
    seen.add(id);
  });
  return { valid: errors.length === 0, errors };
}

/** Build a normalised incident Feature with defaults for optional fields. */
export function makeIncident(fields) {
  const props = {
    id: fields.id,
    source: fields.source,
    sourceKey: fields.sourceKey,
    sourceUrl: fields.sourceUrl ?? null,
    category: fields.category,
    subtype: fields.subtype ?? fields.category,
    title: fields.title,
    summary: fields.summary ?? '',
    severity: {
      label: fields.severity?.label ?? null,
      numeric: fields.severity?.numeric ?? null,
      sourceLevel: fields.severity?.sourceLevel ?? null,
      colorHint: fields.severity?.colorHint ?? null,
    },
    affectedGeometry: fields.affectedGeometry ?? null,
    locationPrecision: fields.locationPrecision ?? 'exact',
    eventStartUtc: fields.eventStartUtc ?? null,
    eventEndUtc: fields.eventEndUtc ?? null,
    sourceUpdatedUtc: fields.sourceUpdatedUtc ?? null,
    fetchedUtc: fields.fetchedUtc ?? null,
    countryCodes: fields.countryCodes ?? [],
    regionText: fields.regionText ?? null,
    attributes: fields.attributes ?? {},
    disclaimer: fields.disclaimer ?? null,
    attribution: fields.attribution ?? null,
    status: fields.status ?? 'active',
  };
  return { type: 'Feature', id: props.id, geometry: fields.geometry, properties: props };
}

/** Deterministic ordering: newest event first, then id — keeps diffs small. */
export function sortIncidents(features) {
  return features.slice().sort((a, b) => {
    const ta = parseUtc(a.properties.eventStartUtc) ?? 0;
    const tb = parseUtc(b.properties.eventStartUtc) ?? 0;
    if (tb !== ta) return tb - ta;
    return a.properties.id < b.properties.id ? -1 : a.properties.id > b.properties.id ? 1 : 0;
  });
}
