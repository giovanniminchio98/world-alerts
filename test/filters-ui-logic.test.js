import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_FILTERS,
  disasterMatches,
  earthquakeMatches,
  isHighSeverity,
  maxAgeBucket,
  mergeFilters,
  summaryCellCount,
  thermalRowMatches,
  weatherMatches,
} from '../src/lib/filters.js';
import { buildUrl, readUrlState } from '../src/lib/url-state.js';
import { foldText, nearestCity, searchCityIndex } from '../src/lib/geocode.js';
import { validateIncidentCollection } from '../src/shared/schema.js';

const NOW = Date.parse('2026-10-04T12:00:00Z');
const ago = (m) => new Date(NOW - m * 60_000).toISOString();
const eq = (mag, ageMin, extra = {}) => ({ category: 'earthquake', eventStartUtc: ago(ageMin), severity: { numeric: mag }, attributes: { depthKm: 10, significant: false, ...extra } });

describe('filters', () => {
  it('applies the time window to earthquakes', () => {
    const f = mergeFilters({ window: '1h' });
    expect(earthquakeMatches(eq(3, 30), f, NOW)).toBe(true);
    expect(earthquakeMatches(eq(3, 90), f, NOW)).toBe(false);
    expect(earthquakeMatches(eq(3, 90), DEFAULT_FILTERS, NOW)).toBe(true);
  });
  it('applies magnitude, depth and significance filters', () => {
    const f = mergeFilters({ earthquake: { minMag: 4.5, depth: 'intermediate', significantOnly: true } });
    expect(earthquakeMatches(eq(5, 10, { depthKm: 100, significant: true }), f, NOW)).toBe(true);
    expect(earthquakeMatches(eq(4, 10, { depthKm: 100, significant: true }), f, NOW)).toBe(false);
    expect(earthquakeMatches(eq(5, 10, { depthKm: 10, significant: true }), f, NOW)).toBe(false);
    expect(earthquakeMatches(eq(5, 10, { depthKm: 100 }), f, NOW)).toBe(false);
  });
  it('keeps ongoing GDACS events active and filters by published level/type', () => {
    const ev = { status: 'active', eventStartUtc: ago(60 * 24 * 30), eventEndUtc: ago(60 * 24 * 10), subtype: 'DR', severity: { sourceLevel: 'Green' } };
    expect(disasterMatches(ev, DEFAULT_FILTERS, NOW)).toBe(true);
    expect(disasterMatches({ ...ev, status: 'past' }, DEFAULT_FILTERS, NOW)).toBe(false);
    expect(disasterMatches(ev, mergeFilters({ disaster: { levels: ['Red'] } }), NOW)).toBe(false);
    expect(disasterMatches({ ...ev, severity: { sourceLevel: null } }, DEFAULT_FILTERS, NOW)).toBe(true); // "not supplied"
  });
  it('drops expired weather alerts and filters by severity', () => {
    const al = { eventEndUtc: new Date(NOW + 3_600_000).toISOString(), severity: { sourceLevel: 'Minor' } };
    expect(weatherMatches(al, DEFAULT_FILTERS, NOW)).toBe(true);
    expect(weatherMatches({ ...al, eventEndUtc: ago(1) }, DEFAULT_FILTERS, NOW)).toBe(false);
    expect(weatherMatches(al, mergeFilters({ weather: { severities: ['Severe'] } }), NOW)).toBe(false);
  });
  it('filters thermal rows and summary counts consistently', () => {
    const nowMin = NOW / 60_000;
    const row = [0, 0, nowMin - 30, 1, 2, 5, 330, 0];
    expect(thermalRowMatches(row, DEFAULT_FILTERS, NOW)).toBe(true);
    expect(thermalRowMatches(row, mergeFilters({ thermal: { sensors: [0] } }), NOW)).toBe(false);
    expect(thermalRowMatches([...row.slice(0, 4), 0, ...row.slice(5)], mergeFilters({ thermal: { minConfidence: 1 } }), NOW)).toBe(false);
    expect(maxAgeBucket(mergeFilters({ window: '1h' }))).toBe(0);
    expect(maxAgeBucket(mergeFilters({ window: '7d' }))).toBe(3);
    const counts = { '0|2|0': 3, '0|0|1': 4, '1|1|3': 5 };
    expect(summaryCellCount(counts, mergeFilters({ window: '24h' }))).toBe(7);
    expect(summaryCellCount(counts, mergeFilters({ window: '7d', thermal: { minConfidence: 1 } }))).toBe(8);
    expect(summaryCellCount(counts, mergeFilters({ window: '7d', thermal: { sensors: [1] } }))).toBe(5);
  });
  it('defines high severity from source classifications only', () => {
    expect(isHighSeverity({ category: 'earthquake', severity: { numeric: 5 } })).toBe(true);
    expect(isHighSeverity({ category: 'earthquake', severity: { numeric: 4.9 } })).toBe(false);
    expect(isHighSeverity({ category: 'disaster', severity: { sourceLevel: 'Orange' } })).toBe(true);
    expect(isHighSeverity({ category: 'weather', severity: { sourceLevel: 'Moderate' } })).toBe(false);
  });
  it('ignores malformed stored filters', () => {
    expect(mergeFilters('nonsense')).toEqual(DEFAULT_FILTERS);
  });
});

describe('URL state', () => {
  const loc = (href) => new URL(href);
  it('round-trips a selected location, window and map view', () => {
    const href = buildUrl(
      { selection: { lat: 35.6895, lon: 139.6917, radiusKm: 250, name: 'Tokyo', countryCode: 'JP' }, window: '7d', view: { zoom: 6, center: [139.7, 35.7] } },
      loc('https://example.github.io/world-alerts/'),
    );
    expect(href).toBe('https://example.github.io/world-alerts/?lat=35.6895&lon=139.6917&r=250&place=Tokyo&cc=JP&w=7d#map=6.00/35.7000/139.7000');
    const s = readUrlState(loc(href));
    expect(s.selection).toEqual({ lat: 35.6895, lon: 139.6917, radiusKm: 250, name: 'Tokyo', countryCode: 'JP' });
    expect(s.window).toBe('7d');
    expect(s.view).toEqual({ zoom: 6, center: [139.7, 35.7] });
  });
  it('rejects invalid coordinates and unknown radii', () => {
    expect(readUrlState(loc('https://x/?lat=200&lon=0')).selection).toBeUndefined();
    expect(readUrlState(loc('https://x/?lat=10&lon=10&r=7')).selection.radiusKm).toBe(100);
    expect(readUrlState(loc('https://x/?lat=10&lon=10&cc=<script>')).selection.countryCode).toBeNull();
  });
});

describe('local place search', () => {
  const cities = [
    ['Paris', 'FR', 48.85, 2.35, 2_100_000],
    ['Paris', 'US', 33.66, -95.55, 25_000],
    ['São Paulo', 'BR', -23.55, -46.63, 12_000_000],
    ['Lyon', 'FR', 45.76, 4.84, 500_000],
    ['Port-au-Prince', 'HT', 18.54, -72.34, 1_200_000],
  ].map(([name, cc, lat, lon, pop]) => ({ name, cc, lat, lon, pop, key: foldText(name) }));
  it('folds accents and punctuation', () => {
    expect(foldText('  São-Paulo! ')).toBe('sao paulo');
  });
  it('ranks exact and prefix matches by population, supports country qualifiers', () => {
    expect(searchCityIndex(cities, 'paris').map((c) => c.countryCode)).toEqual(['FR', 'US']);
    expect(searchCityIndex(cities, 'paris, us').map((c) => c.countryCode)).toEqual(['US']);
    expect(searchCityIndex(cities, 'sao')[0].name).toBe('São Paulo');
    expect(searchCityIndex(cities, 'prince')[0].name).toBe('Port-au-Prince');
    expect(searchCityIndex(cities, 'p')).toEqual([]);
  });
  it('labels a clicked point by its nearest city', () => {
    const near = nearestCity(cities, 4.9, 45.7);
    expect(near).toMatchObject({ name: 'Lyon', countryCode: 'FR' });
    expect(nearestCity(cities, -30, 0)).toBeNull();
  });
});

describe('published fixtures and wording', () => {
  const root = path.resolve(import.meta.dirname, '..');
  it('committed fixture incident files validate against the schema', () => {
    const dir = path.join(root, 'data/fixtures/incidents');
    for (const f of fs.readdirSync(dir)) {
      const fc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      expect(validateIncidentCollection(fc), f).toEqual({ valid: true, errors: [] });
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data/fixtures/manifest.json'), 'utf8'));
    expect(manifest.mode).toBe('fixture');
    for (const s of manifest.sources) expect(['ok', 'stale', 'failed', 'unavailable']).toContain(s.status);
  });
  it('UI code never claims a place is safe or data is real-time', () => {
    const banned = [/\bthis (place|area|location) is safe\b/i, /\bno danger\b/i, /\beverything is normal\b/i, /\b(is|are|shows?|provides?|in|live,) real[- ]time\b/i, /updated every 15 minutes exactly/i];
    const files = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(js|html)$/.test(e.name)) files.push(p);
      }
    };
    walk(path.join(root, 'src'));
    for (const f of ['index.html', 'sources.html', 'about.html']) files.push(path.join(root, f));
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      for (const b of banned) expect(text, `${path.relative(root, f)} matches ${b}`).not.toMatch(b);
    }
  });
});
