#!/usr/bin/env node
// Build static geography assets into public/geo/ (run automatically before dev/build):
//  * countries.json – Natural Earth 1:50m country outlines (TopoJSON, via the
//    `world-atlas` package) annotated with ISO 3166 alpha-2/alpha-3 codes.
//    Used for offline country lookup of clicked points and as a fallback basemap.
//  * cities.json    – populated places (GeoNames data via `all-the-cities`,
//    CC BY 4.0) with population ≥ 50,000 plus all national capitals. Used for
//    instant local search suggestions, so the public geocoder is only queried
//    when the user explicitly submits a search.
//  * emergency-numbers.json – emergency telephone numbers per country, compiled
//    from Wikipedia's "List of emergency telephone numbers" (CC BY-SA 4.0) via the
//    `emergency-numbers` (police/fire/ambulance) and `emergency-and-helplines`
//    (main number + notes) packages. Community-compiled: shown with a
//    "verify locally" note.

import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import countries from 'i18n-iso-countries';
import { ROOT } from './lib/config.js';

const require = createRequire(import.meta.url);
const outDir = path.join(ROOT, 'public/geo');
await fs.mkdir(outDir, { recursive: true });

// Countries ---------------------------------------------------------------
const topo = JSON.parse(await fs.readFile(require.resolve('world-atlas/countries-50m.json'), 'utf8'));
// A few Natural Earth features have no numeric ISO code.
const NAME_FALLBACK = { Kosovo: ['XK', 'XKX'], 'N. Cyprus': ['CY', 'CYP'], Somaliland: ['SO', 'SOM'] };
for (const g of topo.objects.countries.geometries) {
  const name = g.properties?.name;
  const num = g.id != null ? String(g.id).padStart(3, '0') : null;
  const a2 = num ? countries.numericToAlpha2(num) : null;
  const a3 = num ? countries.numericToAlpha3(num) : null;
  const [f2, f3] = NAME_FALLBACK[name] || [];
  g.properties = { name, iso2: a2 || f2 || null, iso3: a3 || f3 || null };
}
delete topo.objects.land;
await fs.writeFile(path.join(outDir, 'countries.json'), JSON.stringify(topo));

// Cities ------------------------------------------------------------------
const cities = require('all-the-cities');
const rows = cities
  .filter((c) => c.population >= 50_000 || c.featureCode === 'PPLC')
  .sort((a, b) => b.population - a.population)
  .map((c) => [c.name, c.country, Math.round(c.loc.coordinates[1] * 1e4) / 1e4, Math.round(c.loc.coordinates[0] * 1e4) / 1e4, c.population]);
await fs.writeFile(
  path.join(outDir, 'cities.json'),
  JSON.stringify({ attribution: 'GeoNames (CC BY 4.0) via all-the-cities', fields: ['name', 'countryCode', 'lat', 'lon', 'population'], rows }),
);
// Emergency numbers ----------------------------------------------------------
const split = require('emergency-numbers/dist/metadata.js').default;
const helplineDir = path.join(path.dirname(require.resolve('emergency-and-helplines')), 'countries');
const numbers = {};
const asNumber = (v) => (v == null || Number(v) === 0 ? null : String(v)); // 0 = missing (lost leading zeros)
const codes = new Set([...Object.keys(split)]);
for (const f of await fs.readdir(helplineDir)) codes.add(path.basename(f, '.json'));
for (const cc of [...codes].sort()) {
  if (!/^[A-Z]{2}$/.test(cc)) continue;
  let main = null;
  try {
    const h = JSON.parse(await fs.readFile(path.join(helplineDir, `${cc}.json`), 'utf8'));
    if (h.emergency?.number) main = { number: String(h.emergency.number).trim(), note: h.emergency.note || null };
  } catch {
    /* no helpline entry */
  }
  const s = split[cc] || {};
  const entry = { police: asNumber(s.police), fire: asNumber(s.fire), ambulance: asNumber(s.ambulance), main: main?.number || null, mainNote: main?.note || null };
  if (entry.police || entry.fire || entry.ambulance || entry.main) numbers[cc] = entry;
}
await fs.writeFile(
  path.join(outDir, 'emergency-numbers.json'),
  JSON.stringify({
    source: 'Wikipedia, "List of emergency telephone numbers" (CC BY-SA 4.0), via the emergency-numbers and emergency-and-helplines packages',
    sourceUrl: 'https://en.wikipedia.org/wiki/List_of_emergency_telephone_numbers',
    disclaimer: 'Community-compiled and not verified official data. Numbers can change — check with local authorities.',
    countries: numbers,
  }),
);

const size = async (f) => ((await fs.stat(path.join(outDir, f))).size / 1024).toFixed(0);
console.log(
  `Geo assets: countries.json ${await size('countries.json')} KB, cities.json ${await size('cities.json')} KB (${rows.length} places), emergency-numbers.json ${await size('emergency-numbers.json')} KB (${Object.keys(numbers).length} countries)`,
);
