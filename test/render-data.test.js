import { describe, expect, it } from 'vitest';
import { disastersToMap, isEnded } from '../src/map/render-data.js';

const event = (id, status, extra = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [10, 10] },
  properties: {
    id, status, subtype: 'FL', locationPrecision: 'area', severity: { colorHint: 'green' },
    affectedGeometry: { type: 'Polygon', coordinates: [[[9, 9], [11, 9], [11, 11], [9, 11], [9, 9]]] },
    attributes: {}, ...extra,
  },
});

describe('ongoing vs ended events on the map', () => {
  it('flags events the source no longer lists as current, and draws them underneath', () => {
    const { points, areas } = disastersToMap([event('a', 'active'), event('b', 'past'), event('c', 'active')]);
    expect(points.features.map((f) => [f.properties.fid, f.properties.ended])).toEqual([['b', true], ['a', false], ['c', false]]);
    expect(areas.features[0].properties).toMatchObject({ fid: 'b', ended: true });
  });

  it('only the source status decides, not dates', () => {
    expect(isEnded({ status: 'active', eventEndUtc: '2020-01-01T00:00:00Z' })).toBe(false);
    expect(isEnded({ status: 'past' })).toBe(true);
    expect(isEnded({})).toBe(false);
  });
});
