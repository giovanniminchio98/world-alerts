// Place search.
//  1. Instant suggestions from a bundled city index (no network requests).
//  2. Worldwide search via OpenStreetMap Nominatim — ONLY when the user submits
//     the search (Enter / button), never per keystroke, at most one request per
//     second, with results cached in this browser. This follows the Nominatim
//     usage policy (https://operations.osmfoundation.org/policies/nominatim/),
//     which forbids client-side autocomplete against the public API.

import { haversineKm, relativePosition } from '../shared/geo.js';
import { load, save } from './storage.js';
import { countryName } from './format.js';

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const MIN_INTERVAL_MS = 1100;
const CACHE_KEY = 'geocode-cache';
const CACHE_MAX = 60;

let citiesPromise = null;

export const foldText = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function loadCities() {
  if (!citiesPromise) {
    citiesPromise = fetch(new URL('geo/cities.json', document.baseURI))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => d.rows.map(([name, cc, lat, lon, pop]) => ({ name, cc, lat, lon, pop, key: foldText(name) })))
      .catch((e) => {
        citiesPromise = null;
        throw e;
      });
  }
  return citiesPromise;
}

/** Search the local index. Supports "city", "city, country" and "city country". */
export function searchCityIndex(cities, query, limit = 8) {
  const q = foldText(query);
  if (q.length < 2) return [];
  const [namePart, countryPart] = query.includes(',') ? query.split(',').map(foldText) : [q, ''];
  const countryMatches = (c) => {
    if (!countryPart) return true;
    return c.cc.toLowerCase() === countryPart || foldText(countryName(c.cc)).startsWith(countryPart);
  };
  const scored = [];
  for (const c of cities) {
    let score = -1;
    if (c.key === namePart) score = 3;
    else if (c.key.startsWith(namePart)) score = 2;
    else if (namePart.length >= 3 && c.key.includes(` ${namePart}`)) score = 1;
    if (score < 0 || !countryMatches(c)) continue;
    scored.push({ c, score });
  }
  scored.sort((a, b) => b.score - a.score || b.c.pop - a.c.pop);
  return scored.slice(0, limit).map(({ c }) => ({
    name: c.name,
    countryCode: c.cc,
    country: countryName(c.cc),
    lat: c.lat,
    lon: c.lon,
    population: c.pop,
    source: 'index',
  }));
}

/** Nearest indexed city to a point, for labelling clicked locations offline. */
export function nearestCity(cities, lon, lat, maxKm = 150) {
  let best = null;
  let bestKm = Infinity;
  for (const c of cities) {
    if (Math.abs(c.lat - lat) > 2.5) continue;
    const d = haversineKm(lat, lon, c.lat, c.lon);
    if (d < bestKm) {
      bestKm = d;
      best = c;
    }
  }
  if (!best || bestKm > maxKm) return null;
  const pos = relativePosition([best.lon, best.lat], [lon, lat]);
  return { name: best.name, countryCode: best.cc, km: bestKm, direction: pos.direction };
}

let lastRequest = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Worldwide search via Nominatim (explicit user action only). */
export async function searchNominatim(query, { signal } = {}) {
  const q = query.trim();
  if (q.length < 2) return [];
  const cacheKey = foldText(q);
  const cache = load(CACHE_KEY, {});
  if (cache[cacheKey]) return cache[cacheKey].results;

  const wait = lastRequest + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '6');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('accept-language', 'en');
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' }, referrerPolicy: 'strict-origin-when-cross-origin' });
  if (!res.ok) throw new Error(`Search service returned HTTP ${res.status}`);
  const json = await res.json();
  const results = json.map((r) => ({
    name: r.name || r.display_name?.split(',')[0] || q,
    displayName: r.display_name,
    countryCode: r.address?.country_code ? r.address.country_code.toUpperCase() : null,
    country: r.address?.country || null,
    lat: Number(r.lat),
    lon: Number(r.lon),
    type: r.type || r.addresstype || null,
    source: 'nominatim',
  }));
  const entries = Object.entries({ ...cache, [cacheKey]: { t: Date.now(), results } })
    .sort((a, b) => b[1].t - a[1].t)
    .slice(0, CACHE_MAX);
  save(CACHE_KEY, Object.fromEntries(entries));
  return results;
}
