import { describe, expect, it } from 'vitest';
import {
  bearingDeg,
  compassDirection,
  describeRelativePosition,
  filterByRadius,
  formatDistance,
  geometryContainsPoint,
  haversineKm,
  radiusBbox,
  relativePosition,
  simplifyLine,
  mergePolygons,
  wrapLon,
} from '../src/shared/geo.js';

describe('haversineKm', () => {
  it('is zero for identical points', () => {
    expect(haversineKm(10, 20, 10, 20)).toBe(0);
  });
  it('matches known city distances (R = 6371 km)', () => {
    // London → Paris ≈ 343.5 km; New York → Los Angeles ≈ 3936 km
    expect(haversineKm(51.5074, -0.1278, 48.8566, 2.3522)).toBeCloseTo(343.5, 0);
    expect(haversineKm(40.7128, -74.006, 34.0522, -118.2437)).toBeGreaterThan(3925);
    expect(haversineKm(40.7128, -74.006, 34.0522, -118.2437)).toBeLessThan(3945);
  });
  it('handles the antimeridian and antipodes', () => {
    expect(haversineKm(0, 179.5, 0, -179.5)).toBeCloseTo(111.2, 0);
    expect(haversineKm(0, 0, 0, 180)).toBeCloseTo(Math.PI * 6371, 0);
  });
  it('is symmetric', () => {
    expect(haversineKm(35, 139, -33, 151)).toBeCloseTo(haversineKm(-33, 151, 35, 139), 9);
  });
});

describe('bearing and compass direction', () => {
  it('computes cardinal bearings', () => {
    expect(bearingDeg(0, 0, 1, 0)).toBeCloseTo(0, 5);
    expect(bearingDeg(0, 0, 0, 1)).toBeCloseTo(90, 5);
    expect(bearingDeg(0, 0, -1, 0)).toBeCloseTo(180, 5);
    expect(bearingDeg(0, 0, 0, -1)).toBeCloseTo(270, 5);
  });
  it('maps bearings to eight compass points', () => {
    expect(compassDirection(0)).toBe('north');
    expect(compassDirection(22)).toBe('north');
    expect(compassDirection(23)).toBe('northeast');
    expect(compassDirection(135)).toBe('southeast');
    expect(compassDirection(180)).toBe('south');
    expect(compassDirection(225)).toBe('southwest');
    expect(compassDirection(270)).toBe('west');
    expect(compassDirection(315)).toBe('northwest');
    expect(compassDirection(359)).toBe('north');
    expect(compassDirection(-45)).toBe('northwest');
    expect(compassDirection(90, { short: true })).toBe('E');
  });
  it('describes an event position relative to a place', () => {
    const tokyo = [139.69, 35.69];
    const pos = relativePosition(tokyo, [140.3, 35.2]);
    expect(pos.direction).toBe('southeast');
    expect(describeRelativePosition(tokyo, [140.3, 35.2])).toMatch(/^\d+ km southeast$/);
    expect(describeRelativePosition(tokyo, tokyo)).toBe('at the selected location');
  });
});

describe('formatDistance', () => {
  it('formats kilometres and miles', () => {
    expect(formatDistance(0.4)).toBe('<1 km');
    expect(formatDistance(5.25)).toBe('5.3 km');
    expect(formatDistance(78.4)).toBe('78 km');
    expect(formatDistance(1500)).toBe('1,500 km');
    expect(formatDistance(160.9344, 'mi')).toBe('100 mi');
    expect(formatDistance(NaN)).toBe('');
  });
});

describe('geometry containment', () => {
  const square = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] };
  it('detects points inside polygons, excluding holes', () => {
    expect(geometryContainsPoint(square, [2, 2])).toBe(true);
    expect(geometryContainsPoint(square, [5, 5])).toBe(false);
    expect(geometryContainsPoint(square, [11, 5])).toBe(false);
  });
  it('supports MultiPolygon and ignores points/lines', () => {
    const multi = mergePolygons([square, { type: 'Polygon', coordinates: [[[20, 20], [30, 20], [30, 30], [20, 20]]] }]);
    expect(multi.type).toBe('MultiPolygon');
    expect(geometryContainsPoint(multi, [28, 22])).toBe(true);
    expect(geometryContainsPoint({ type: 'Point', coordinates: [1, 1] }, [1, 1])).toBe(false);
    expect(geometryContainsPoint(null, [1, 1])).toBe(false);
  });
});

describe('radius filtering', () => {
  it('keeps only points within the radius, nearest first', () => {
    const origin = [0, 0];
    const items = [{ c: [0, 0.5] }, { c: [0, 2] }, { c: [0.2, 0] }, { c: null }];
    const out = filterByRadius(items, origin, 100, (i) => i.c);
    expect(out.map((o) => o.item.c)).toEqual([[0.2, 0], [0, 0.5]]);
    expect(out[0].direction).toBe('east');
  });
  it('builds a bounding box that contains the radius', () => {
    const [w, s, e, n] = radiusBbox(10, 50, 100);
    expect(haversineKm(50, 10, n, 10)).toBeCloseTo(100, 0);
    expect(haversineKm(50, 10, 50, e)).toBeGreaterThanOrEqual(99);
    expect(w).toBeLessThan(10);
    expect(s).toBeLessThan(50);
  });
});

describe('misc helpers', () => {
  it('wraps longitudes', () => {
    expect(wrapLon(190)).toBe(-170);
    expect(wrapLon(-190)).toBe(170);
  });
  it('simplifies lines while keeping endpoints', () => {
    const line = [[0, 0], [1, 0.001], [2, 0], [3, 0.002], [4, 0]];
    const s = simplifyLine(line, 0.01);
    expect(s[0]).toEqual([0, 0]);
    expect(s[s.length - 1]).toEqual([4, 0]);
    expect(s.length).toBeLessThan(line.length);
  });
});
