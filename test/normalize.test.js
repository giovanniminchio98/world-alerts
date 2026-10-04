import { describe, expect, it } from 'vitest';
import * as usgs from '../scripts/sources/usgs.mjs';
import * as gdacs from '../scripts/sources/gdacs.mjs';
import * as firms from '../scripts/sources/firms.mjs';
import * as nws from '../scripts/sources/nws.mjs';
import * as eonet from '../scripts/sources/eonet.mjs';
import { validateIncidentCollection, validateIncident, makeIncident } from '../src/shared/schema.js';
import { confidenceClass, acquisitionTimeMs, tileKeyFor, tileKeysForBbox, decodeRow } from '../src/shared/firms-codec.js';
import { sampleEonet, sampleFirms, sampleGdacs, sampleGdacsRss, sampleNws, sampleUsgs } from './fixtures/sample-sources.mjs';

const NOW = Date.parse('2026-10-04T12:00:00Z');
const ctx = { now: NOW, nowIso: '2026-10-04T12:00:00Z', log: () => {} };
const incidents = (out, key) => out.files[`incidents/${key}.json`];

describe('USGS normalisation', () => {
  const out = usgs.normalize(sampleUsgs(NOW), ctx);
  const fc = incidents(out, usgs.key);
  it('produces a valid incident collection', () => {
    expect(validateIncidentCollection(fc)).toEqual({ valid: true, errors: [] });
    expect(out.records).toBe(fc.features.length);
  });
  it('maps magnitude, depth, tsunami flag, PAGER alert, times and link', () => {
    const f = fc.features.find((x) => x.properties.title.includes('Hualien'));
    const p = f.properties;
    expect(p.category).toBe('earthquake');
    expect(p.severity).toMatchObject({ label: 'M 6.1', numeric: 6.1, sourceLevel: 'yellow', colorHint: 'red' });
    expect(p.attributes).toMatchObject({ depthKm: 18, tsunami: true, pagerAlert: 'yellow', significant: true });
    expect(f.geometry.coordinates).toEqual([121.71, 23.97]);
    expect(p.eventStartUtc).toBe('2026-10-04T07:00:00Z');
    expect(p.sourceUpdatedUtc).toBe('2026-10-04T07:20:00Z');
    expect(p.fetchedUtc).toBe('2026-10-04T12:00:00Z');
    expect(p.sourceUrl).toMatch(/^https:\/\/earthquake\.usgs\.gov\//);
  });
  it('uses the colour scale from the spec', () => {
    const hint = (mag) => fc.features.find((f) => f.properties.severity.numeric === mag)?.properties.severity.colorHint;
    expect(hint(6.1)).toBe('red');
    expect(hint(5.6)).toBe('orange');
    expect(hint(4.7)).toBe('yellow');
    expect(hint(2.1)).toBe('blue');
  });
  it('sorts deterministically (newest first) and reports source times', () => {
    const times = fc.features.map((f) => Date.parse(f.properties.eventStartUtc));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(out.sourceLatestDataTimeUtc).toBe('2026-10-04T11:58:00Z');
    expect(JSON.stringify(usgs.normalize(sampleUsgs(NOW), ctx))).toBe(JSON.stringify(out));
  });
  it('rejects a non-GeoJSON response', () => {
    expect(() => usgs.normalize({ hello: 'world' }, ctx)).toThrow();
  });
});

describe('GDACS normalisation', () => {
  const out = gdacs.normalize(sampleGdacs(NOW), ctx);
  const fc = incidents(out, gdacs.key);
  const byType = (t) => fc.features.find((f) => f.properties.subtype === t);
  it('groups points, polygons and tracks per event and validates', () => {
    expect(validateIncidentCollection(fc).valid).toBe(true);
    expect(fc.features).toHaveLength(6); // the 45-day-old past event is dropped
    expect(byType('TC').properties.affectedGeometry.type).toBe('Polygon');
    expect(byType('TC').properties.attributes.track.type).toBe('MultiLineString');
  });
  it('keeps GDACS alert levels as published and never invents a severity', () => {
    expect(byType('EQ').properties.severity).toMatchObject({ sourceLevel: 'Orange', colorHint: 'orange' });
    expect(byType('VO').properties.severity.colorHint).toBe('green');
  });
  it('labels representative locations for area hazards without geometry', () => {
    const fl = byType('FL').properties;
    expect(fl.locationPrecision).toBe('representative');
    expect(fl.disclaimer).toMatch(/Representative event location — affected area may be broader/);
    expect(byType('TC').properties.locationPrecision).toBe('area');
    expect(byType('EQ').properties.locationPrecision).toBe('exact');
  });
  it('parses GDACS no-zone dates as UTC and maps country codes', () => {
    expect(byType('DR').properties.countryCodes).toEqual(['ET', 'KE', 'SO']);
    expect(byType('EQ').properties.eventStartUtc).toBe('2026-10-04T07:00:00Z');
  });
  it('parses the GeoRSS fallback', () => {
    const rss = gdacs.normalize({ format: 'rss', data: sampleGdacsRss(NOW) }, ctx);
    const feats = incidents(rss, gdacs.key).features;
    expect(validateIncidentCollection(incidents(rss, gdacs.key)).valid).toBe(true);
    expect(feats).toHaveLength(2);
    const ng = feats.find((f) => f.properties.countryCodes.includes('NG'));
    expect(ng.geometry.coordinates).toEqual([7.49, 9.08]);
    expect(ng.properties.summary).toBe('Sample flood & rain event');
    const gr = feats.find((f) => f.properties.subtype === 'EQ');
    expect(gr.geometry.coordinates).toEqual([23.1, 38.2]);
    expect(gr.properties.countryCodes).toEqual(['GR']);
  });
});

describe('NASA FIRMS normalisation', () => {
  const out = firms.normalize(sampleFirms(NOW), ctx);
  it('writes an index, summary grid and tiles', () => {
    const idx = out.files['fires/index.json'];
    expect(idx.sensors).toEqual(['VIIRS (NOAA-20)', 'MODIS (Terra/Aqua)']);
    const tileFiles = Object.keys(out.files).filter((k) => k.startsWith('fires/tiles/'));
    expect(tileFiles.length).toBe(Object.keys(idx.tiles).length);
    const total = Object.values(idx.tiles).reduce((a, b) => a + b, 0);
    expect(total).toBe(out.records);
    const summaryTotal = out.files['fires/summary.json'].rows.reduce((s, r) => s + Object.values(r[4]).reduce((a, b) => a + b, 0), 0);
    expect(summaryTotal).toBe(out.records);
    expect(out.replaceDirs).toEqual(['fires/tiles']);
  });
  it('places detections in the right tile and keeps the 7-day window', () => {
    for (const [path, tile] of Object.entries(out.files).filter(([k]) => k.startsWith('fires/tiles/'))) {
      for (const row of tile.rows) {
        expect(tileKeyFor(row[0], row[1])).toBe(tile.tile);
        expect(row[2] * 60_000).toBeGreaterThanOrEqual(NOW - 7 * 86_400_000 - 60_000);
        expect(row[4]).toBeGreaterThanOrEqual(0);
        expect(row[4]).toBeLessThanOrEqual(2);
      }
      expect(path).toBe(`fires/tiles/${tile.tile}.json`);
    }
  });
  it('caps the number of detections and records it', () => {
    process.env.FIRMS_MAX_DETECTIONS = '100';
    try {
      const capped = firms.normalize(sampleFirms(NOW), ctx);
      expect(capped.records).toBe(100);
      expect(capped.files['fires/index.json'].truncated).toBe(true);
      expect(capped.notes).toMatch(/capped/);
    } finally {
      delete process.env.FIRMS_MAX_DETECTIONS;
    }
  });
  it('fails on an empty or non-CSV response instead of publishing nothing', () => {
    expect(() => firms.normalize({ mode: 'x', parts: [{ product: 'MODIS_NRT', csv: [''] }] }, ctx)).toThrow();
    expect(() => firms.normalize({ mode: 'x', parts: [{ product: 'MODIS_NRT', csv: ['foo,bar\n1,2'] }] }, ctx)).toThrow();
  });
  it('codec helpers', () => {
    expect(confidenceClass('l')).toBe(0);
    expect(confidenceClass('n')).toBe(1);
    expect(confidenceClass('h')).toBe(2);
    expect(confidenceClass('25')).toBe(0);
    expect(confidenceClass('50')).toBe(1);
    expect(confidenceClass('95')).toBe(2);
    expect(acquisitionTimeMs('2026-10-04', '135')).toBe(Date.parse('2026-10-04T01:35:00Z'));
    expect(acquisitionTimeMs('2026-10-04', '1405')).toBe(Date.parse('2026-10-04T14:05:00Z'));
    expect(tileKeysForBbox([175, 0, -175, 5])).toEqual(expect.arrayContaining(['35_9', '0_9']));
    expect(decodeRow([1, 2, 100, 0, 2, 5.5, 330, 1], ['S'])).toMatchObject({ sensor: 'S', confidenceLabel: 'high', dayNight: 'night', timeMs: 6_000_000 });
  });
});

describe('NWS normalisation', () => {
  const out = nws.normalize(sampleNws(NOW), ctx);
  const fc = incidents(out, nws.key);
  it('validates, drops expired alerts and resolves zone geometry', () => {
    expect(validateIncidentCollection(fc).valid).toBe(true);
    expect(fc.features.some((f) => f.properties.attributes.event === 'Wind Advisory')).toBe(false);
    const heat = fc.features.find((f) => f.properties.attributes.event === 'Heat Advisory');
    expect(heat.properties.locationPrecision).toBe('zone');
    expect(heat.geometry.type).toBe('Polygon');
  });
  it('reports alerts whose zone outline is not yet available', () => {
    expect(out.extraMeta.unplacedAlerts).toBe(1);
    expect(out.notes).toMatch(/could not be drawn yet/);
  });
  it('preserves severity / urgency / certainty and sorts most severe first', () => {
    expect(fc.features[0].properties.attributes).toMatchObject({ severity: 'Extreme', urgency: 'Immediate', certainty: 'Observed' });
    expect(fc.features.map((f) => f.properties.countryCodes)).toEqual(fc.features.map(() => ['US']));
  });
  it('keeps the zone cache bounded and marks used zones', () => {
    const zones = out.files['cache/nws-zones.json'].zones;
    expect(Object.values(zones)[0].lastUsedUtc).toBe('2026-10-04T12:00:00Z');
  });
});

describe('schema validation', () => {
  const good = makeIncident({ id: 'x:1', source: 'X', sourceKey: 'x', category: 'earthquake', title: 'T', geometry: { type: 'Point', coordinates: [1, 2] } });
  it('accepts a minimal incident', () => {
    expect(validateIncident(good)).toEqual([]);
  });
  it('rejects broken incidents', () => {
    expect(validateIncident({ ...good, geometry: { type: 'Point', coordinates: [1, 200] } })).toContain('invalid geometry');
    expect(validateIncident({ ...good, properties: { ...good.properties, category: 'rumour' } })[0]).toMatch(/unknown category/);
    expect(validateIncident({ ...good, properties: { ...good.properties, eventStartUtc: 'yesterday-ish' } })[0]).toMatch(/not a valid time/);
    expect(validateIncident({ ...good, properties: { ...good.properties, sourceUrl: 'javascript:alert(1)' } })).toContain('sourceUrl must be http(s)');
    expect(validateIncidentCollection({ type: 'FeatureCollection', features: [good, good] }).errors[0]).toMatch(/duplicate id/);
    expect(validateIncidentCollection({ features: [] }).valid).toBe(false);
  });
});

describe('NASA EONET normalisation', () => {
  const out = eonet.normalize(sampleEonet(NOW), ctx);
  const fc = incidents(out, eonet.key);
  const byType = (t) => fc.features.find((f) => f.properties.subtype === t);
  it('validates and skips earthquakes (USGS is used) and sea ice', () => {
    expect(validateIncidentCollection(fc)).toEqual({ valid: true, errors: [] });
    expect(fc.features.map((f) => f.properties.subtype).sort()).toEqual(['floods', 'severeStorms', 'volcanoes', 'wildfires']);
  });
  it('uses the latest position, keeps storm paths and never invents severity', () => {
    const storm = byType('severeStorms').properties;
    expect(byType('severeStorms').geometry.coordinates).toEqual([-74.6, 24.5]);
    expect(storm.locationPrecision).toBe('representative');
    expect(storm.attributes.track.coordinates).toHaveLength(4);
    expect(storm.severity).toMatchObject({ label: '105 kts', sourceLevel: null, colorHint: null });
    expect(storm.eventStartUtc).toBe('2026-10-01T12:00:00Z');
    expect(storm.sourceUpdatedUtc).toBe('2026-10-04T09:00:00Z');
  });
  it('treats a stationary wildfire as an exact point without a track', () => {
    const wf = byType('wildfires').properties;
    expect(wf.locationPrecision).toBe('exact');
    expect(wf.attributes.track).toBeNull();
    expect(wf.severity.label).toBe('2,300 acres');
  });
  it('keeps polygon events as affected areas', () => {
    const fl = byType('floods').properties;
    expect(fl.locationPrecision).toBe('area');
    expect(fl.affectedGeometry.type).toBe('Polygon');
  });
  it('rejects a response without an events array', async () => {
    await expect(eonet.fetchRaw({ fetchJson: async () => ({}) })).rejects.toThrow(/no events/);
  });
});
