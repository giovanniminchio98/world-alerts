import { describe, expect, it } from 'vitest';
import { eonetMagnitudeScale, gdacsLevelSteps, magnitudeClass, magnitudeScale, windScale } from '../src/ui/scales.js';

const text = (h) => String(h);

describe('detail scales', () => {
  it('earthquake magnitude sits on a 0–10 bar with the USGS magnitude class', () => {
    expect(magnitudeClass(4.7)).toBe('light');
    expect(magnitudeClass(7.2)).toBe('major');
    expect(text(magnitudeScale(4.7))).toContain('--sp:47%');
    expect(text(magnitudeScale(NaN))).toBe('');
  });
  it('wind is shown against storm-category marks without claiming a category', () => {
    const out = text(windScale(204));
    expect(out).toContain('204 km/h');
    expect(out).not.toMatch(/Category \d/);
  });
  it('reads EONET sizes written as text', () => {
    expect(text(eonetMagnitudeScale('95 kts'))).toContain('176 km/h');
    expect(text(eonetMagnitudeScale('5,072 acres'))).toContain('2,053 ha');
    expect(text(eonetMagnitudeScale('unknown'))).toBe('');
  });
  it('marks the published GDACS level and only that one', () => {
    const out = text(gdacsLevelSteps('Orange', 2));
    expect(out.match(/is-on/g)).toHaveLength(1);
    expect(text(gdacsLevelSteps(undefined))).toBe('');
  });
});
