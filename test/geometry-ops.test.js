import { describe, expect, it } from 'vitest';
import { joinSegments, unionPolygons } from '../scripts/lib/geometry-ops.js';

const circle = (x, y, r, n = 16) => {
  const ring = [];
  for (let i = 0; i <= n; i++) ring.push([x + r * Math.cos((2 * Math.PI * i) / n), y + r * Math.sin((2 * Math.PI * i) / n)]);
  ring[n] = ring[0];
  return { type: 'Polygon', coordinates: [ring] };
};

describe('cyclone geometry clean-up', () => {
  it('unions overlapping wind circles into one outline', () => {
    const steps = Array.from({ length: 12 }, (_, i) => circle(i * 0.5, i * 0.3, 1));
    const u = unionPolygons(steps);
    expect(u.type).toBe('Polygon');
    expect(u.coordinates).toHaveLength(1); // single outer ring, no holes
  });
  it('keeps separate areas separate', () => {
    expect(unionPolygons([circle(0, 0, 1), circle(10, 10, 1)]).type).toBe('MultiPolygon');
    expect(unionPolygons([])).toBeNull();
  });
  it('joins shuffled directed 2-point segments into the storm path, oldest first', () => {
    const seg = (a, b) => ({ type: 'LineString', coordinates: [a, b] });
    const path = [[-101.3, 14.7], [-101.4, 15], [-101.8, 15.4], [-102.4, 15.7], [-102.4, 16]];
    const shuffled = [seg(path[2], path[3]), seg(path[0], path[1]), seg(path[3], path[4]), seg(path[1], path[2])];
    expect(joinSegments(shuffled)).toEqual({ type: 'LineString', coordinates: path });
  });
  it('returns separate chains when segments do not connect', () => {
    const out = joinSegments([{ type: 'LineString', coordinates: [[0, 0], [1, 1]] }, { type: 'LineString', coordinates: [[5, 5], [6, 6]] }]);
    expect(out.type).toBe('MultiLineString');
  });
});
