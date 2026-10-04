// Places saved for offline use — stored only in this browser.
import { load, save } from './storage.js';

const KEY = 'savedPlaces';
const MAX = 20;
const same = (a, b) => Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 1e-4;

export const listSaved = () => load(KEY, []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
export const isSaved = (sel) => listSaved().some((p) => same(p, sel));

export function addSaved(sel) {
  const place = {
    name: sel.name || 'Saved place',
    lat: sel.lat,
    lon: sel.lon,
    countryCode: sel.countryCode || null,
    radiusKm: sel.radiusKm,
    savedAt: new Date().toISOString(),
  };
  save(KEY, [place, ...listSaved().filter((p) => !same(p, sel))].slice(0, MAX));
  return place;
}

export function removeSaved(sel) {
  save(KEY, listSaved().filter((p) => !same(p, sel)));
}
