// Formatting helpers that respect viewer preferences (units, local vs UTC).
import { formatDateTime, formatRelative } from '../shared/time.js';
import { formatDistance, describeRelativePosition } from '../shared/geo.js';
import { getPrefs } from './prefs.js';

export const fmtTime = (value, opts = {}) => formatDateTime(value, { utc: getPrefs().timeMode === 'utc', ...opts });
export const fmtBoth = (value) => `${formatDateTime(value)} / ${formatDateTime(value, { utc: true })}`;
export const fmtAgo = (value, now = Date.now()) => formatRelative(value, now);
export const fmtDist = (km) => formatDistance(km, getPrefs().units);
export const fmtRelPos = (origin, target) => describeRelativePosition(origin, target, getPrefs().units);

/** "<time datetime=…>12 Oct 2026, 14:05 CEST</time> (3 h ago)" */
export function timeWithAgo(value, now = Date.now()) {
  if (!value) return 'unknown';
  return `${fmtTime(value)} (${fmtAgo(value, now)})`;
}

export function fmtCoords(lon, lat) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(3)}° ${ns}, ${Math.abs(lon).toFixed(3)}° ${ew}`;
}

const regionNames = typeof Intl !== 'undefined' && Intl.DisplayNames ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
export function countryName(code) {
  if (!code) return null;
  try {
    return regionNames?.of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}
