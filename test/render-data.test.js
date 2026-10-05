import { describe, expect, it } from 'vitest';
import { disastersToMap } from '../src/map/render-data.js';
import { activityState, disasterMatches, mergeFilters } from '../src/lib/filters.js';

const NOW = Date.parse('2026-10-05T11:20:00Z');
const H = 3_600_000;
const iso = (ms) => new Date(ms).toISOString();

const event = (id, { status = 'active', endH = -2, updH = -1 } = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [10, 10] },
  properties: {
    id, status, category: 'disaster', subtype: 'FL', locationPrecision: 'area',
    severity: { colorHint: 'green', sourceLevel: 'Green' },
    eventStartUtc: iso(NOW - 96 * H), eventEndUtc: iso(NOW + endH * H), sourceUpdatedUtc: iso(NOW + updH * H),
    affectedGeometry: { type: 'Polygon', coordinates: [[[9, 9], [11, 9], [11, 11], [9, 11], [9, 9]]] },
    attributes: {},
  },
});

describe('ongoing vs not-ongoing events', () => {
  it('ongoing = listed as current and updated in the last 24 h', () => {
    expect(activityState(event('a').properties, NOW)).toBe('ongoing');
    // GDACS still says "current", but the latest assessment ended 34 h ago (Flood in Portugal, 5 Oct).
    expect(activityState(event('pt', { endH: -34, updH: -4 }).properties, NOW)).toBe('quiet');
    expect(activityState(event('b', { status: 'past' }).properties, NOW)).toBe('ended');
    // A cyclone forecast reaching into the future is ongoing.
    expect(activityState(event('tc', { endH: 30 }).properties, NOW)).toBe('ongoing');
  });

  it('agrees with the time window: the 24 h view only shows ongoing events', () => {
    const pt = event('pt', { endH: -34, updH: -4 }).properties;
    expect(disasterMatches(pt, mergeFilters({ window: '24h' }), NOW)).toBe(false);
    expect(disasterMatches(pt, mergeFilters({ window: '48h' }), NOW)).toBe(true);
  });

  it('marks not-ongoing events and draws them underneath ongoing ones', () => {
    const { points, areas } = disastersToMap([event('a'), event('b', { status: 'past' }), event('pt', { endH: -34 })], NOW);
    expect(points.features.map((f) => [f.properties.fid, f.properties.ended])).toEqual([['b', true], ['pt', true], ['a', false]]);
    expect(areas.features[0].properties).toMatchObject({ fid: 'b', ended: true });
  });
});
