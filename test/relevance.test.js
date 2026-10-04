import { describe, expect, it } from 'vitest';
import { buildLocationReport, NO_MATCH_SUMMARY, inCoverage } from '../src/lib/relevance.js';
import { DEFAULT_FILTERS, mergeFilters } from '../src/lib/filters.js';
import * as usgs from '../scripts/sources/usgs.mjs';
import * as gdacs from '../scripts/sources/gdacs.mjs';
import * as firms from '../scripts/sources/firms.mjs';
import * as nws from '../scripts/sources/nws.mjs';
import { sampleFirms, sampleGdacs, sampleNws, sampleUsgs } from './fixtures/sample-sources.mjs';
import sourcesConfig from '../config/sources.json';

const NOW = Date.parse('2026-10-04T12:00:00Z');
const ctx = { now: NOW, nowIso: '2026-10-04T12:00:00Z', log: () => {} };
const fcOf = (mod, raw) => mod.normalize(raw, ctx).files[`incidents/${mod.key}.json`];
const datasets = {
  earthquake: fcOf(usgs, sampleUsgs(NOW)),
  disaster: fcOf(gdacs, sampleGdacs(NOW)),
  weather: fcOf(nws, sampleNws(NOW)),
};
const firesOut = firms.normalize(sampleFirms(NOW), ctx);
const allRows = Object.entries(firesOut.files).filter(([k]) => k.startsWith('fires/tiles/')).flatMap(([, t]) => t.rows);
const thermal = { rows: allRows, sensors: firesOut.files['fires/index.json'].sensors };

const okSources = sourcesConfig.sources.map((s) => ({
  ...s,
  sourceKey: s.key,
  lastAttemptOk: true,
  lastSuccessfulFetchUtc: s.implemented === false ? null : '2026-10-04T11:55:00Z',
}));

function report(selection, { filters = DEFAULT_FILTERS, sources = okSources, extra = {} } = {}) {
  return buildLocationReport({ selection: { radiusKm: 100, ...selection }, datasets, thermal, sources, filters, now: NOW, ...extra });
}
const cat = (r, c) => r.categories.find((x) => x.category === c);
const BANNED = /\b(safe|no danger|no problems?|everything is normal|all clear)\b/i;
const allText = (r) => JSON.stringify([r.summaryLines, r.categories.map((c) => [c.headline, c.freshness, c.note])]);

describe('location report scenarios', () => {
  it('a city near a recent earthquake (Hualien, Taiwan)', () => {
    const r = report({ lon: 121.6, lat: 23.99, countryCode: 'TW' });
    const eq = cat(r, 'earthquake');
    expect(eq.state).toBe('found');
    expect(eq.items[0].feature.properties.severity.label).toBe('M 6.1');
    expect(eq.items[0].direction).toBe('east');
    expect(eq.items[0].km).toBeGreaterThan(5);
    expect(eq.items[0].km).toBeLessThan(20);
    expect(cat(r, 'disaster').items[0].relation).toBe('inside-area');
    expect(r.highCount).toBe(2);
    expect(r.summaryLines[0]).toMatch(/^2 monitored incidents found within 100 km/);
  });

  it('a city without nearby reported events (Paris) uses the no-match wording, never "safe"', () => {
    const r = report({ lon: 2.35, lat: 48.85, countryCode: 'FR' });
    expect(r.incidentCount).toBe(0);
    expect(r.summaryLines[0]).toBe(NO_MATCH_SUMMARY);
    expect(cat(r, 'earthquake').headline).toBe('No matching incidents detected by connected sources');
    expect(allText(r)).not.toMatch(BANNED);
    expect(r.coverageNote).toMatch(/does not confirm that no disruption exists/);
  });

  it('an area with satellite thermal detections (Rondônia, Brazil)', () => {
    const r = report({ lon: -63.0, lat: -10.5, countryCode: 'BR' }, { filters: mergeFilters({ window: '7d' }) });
    const t = cat(r, 'thermal');
    expect(t.state).toBe('found');
    expect(t.thermal.count).toBeGreaterThan(10);
    expect(t.thermal.nearest).toHaveLength(5);
    expect(t.thermal.nearest[0].km).toBeLessThanOrEqual(t.thermal.nearest[4].km);
    expect(r.incidentCount).toBe(0);
    expect(r.summaryLines.join(' ')).toMatch(/not necessarily wildfires/);
  });

  it('a US location inside an active NWS alert (Houston)', () => {
    const r = report({ lon: -95.37, lat: 29.76, countryCode: 'US' });
    const wx = cat(r, 'weather');
    expect(wx.state).toBe('found');
    expect(wx.items[0].relation).toBe('inside-area');
    expect(wx.items[0].feature.properties.attributes.event).toBe('Flood Warning');
  });

  it('a zone-based NWS alert matches by containment (Phoenix)', () => {
    const wx = cat(report({ lon: -112.07, lat: 33.45, countryCode: 'US' }), 'weather');
    expect(wx.items.map((i) => i.feature.properties.attributes.event)).toEqual(['Heat Advisory']);
  });

  it('weather coverage is unavailable outside the United States', () => {
    const wx = cat(report({ lon: 2.35, lat: 48.85, countryCode: 'FR' }), 'weather');
    expect(wx.state).toBe('coverage-unavailable');
    expect(wx.headline).toBe('Coverage unavailable for this area');
  });

  it('unsupported power / internet coverage is reported as not connected', () => {
    const r = report({ lon: -95.37, lat: 29.76, countryCode: 'US' });
    expect(cat(r, 'power')).toMatchObject({ state: 'not-connected', headline: 'No electricity-outage data source is currently connected for this location.' });
    expect(cat(r, 'internet').state).toBe('not-connected');
    expect(allText(r)).not.toMatch(/no power outage|internet is working/i);
  });

  it('GDACS country-level and representative matches carry no fake precision', () => {
    // Chittagong is >100 km from the Bangladesh flood's representative point.
    const r = report({ lon: 91.83, lat: 22.36, countryCode: 'BD' });
    const fl = cat(r, 'disaster').items.find((i) => i.feature.properties.subtype === 'FL');
    expect(fl.relation).toBe('country');
    const near = report({ lon: 90.41, lat: 23.81, countryCode: 'BD' });
    expect(cat(near, 'disaster').items[0].relation).toBe('representative');
  });

  it('respects the selected radius and filters', () => {
    const tight = report({ lon: 121.6, lat: 23.99, countryCode: 'TW', radiusKm: 5 });
    expect(cat(tight, 'earthquake').state).toBe('none');
    const highMag = report({ lon: -118.2, lat: 34.05, countryCode: 'US' }, { filters: mergeFilters({ window: '7d', earthquake: { minMag: 4.5 } }) });
    expect(cat(highMag, 'earthquake').items).toHaveLength(0);
    const all = report({ lon: -118.2, lat: 34.05, countryCode: 'US' }, { filters: mergeFilters({ window: '7d' }) });
    expect(cat(all, 'earthquake').items.length).toBeGreaterThanOrEqual(3);
  });

  it('labels stale and failed sources instead of hiding them', () => {
    const sources = okSources.map((s) => {
      if (s.key === 'usgs-earthquakes') return { ...s, lastSuccessfulFetchUtc: '2026-10-04T09:00:00Z' };
      if (s.key === 'gdacs-disasters') return { ...s, lastSuccessfulFetchUtc: null, lastAttemptOk: false };
      if (s.key === 'firms-hotspots') return { ...s, lastSuccessfulFetchUtc: '2026-10-04T06:00:00Z', lastAttemptOk: false };
      return s;
    });
    const r = report({ lon: 2.35, lat: 48.85, countryCode: 'FR' }, { sources, extra: { formatTime: () => 'TIME' } });
    expect(cat(r, 'earthquake').freshness).toBe('Data is stale; last successful refresh was TIME.');
    expect(cat(r, 'disaster')).toMatchObject({ state: 'source-unavailable', headline: 'Source temporarily unavailable — no data currently available.' });
    expect(cat(r, 'thermal').freshness).toBe('This source could not be refreshed. Showing last valid data from TIME.');
    expect(r.summaryLines.at(-1)).toMatch(/stale or unavailable/);
  });

  it('a browser-side load error is treated as unavailable', () => {
    const r = report({ lon: 2.35, lat: 48.85, countryCode: 'FR' }, { extra: { loadErrors: { earthquake: true } } });
    expect(cat(r, 'earthquake').state).toBe('source-unavailable');
  });

  it('inCoverage only restricts regional sources', () => {
    expect(inCoverage({ scope: 'global' }, {})).toBe(true);
    expect(inCoverage({ scope: 'regional', regionCountryCodes: ['US'] }, { countryCode: 'us' })).toBe(true);
    expect(inCoverage({ scope: 'regional', regionCountryCodes: ['US'] }, {})).toBe(false);
  });
});
