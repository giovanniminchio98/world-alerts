// Offline country lookup for clicked points using bundled Natural Earth outlines.
// Approximate near borders and coasts (1:50m generalisation).
import { feature } from 'topojson-client';
import { geometryBbox, geometryContainsPoint } from '../shared/geo.js';

let loading = null;

/**
 * Natural Earth rings that cross the antimeridian (Russia, Fiji) jump from
 * +180 to -180, which a WebGL renderer draws as lines across the world.
 * Shift their western longitudes by +360 so each ring is continuous; MapLibre
 * renders longitudes beyond 180 on the adjacent world copy.
 */
export function fixAntimeridian(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  for (const poly of polys) {
    for (const ring of poly) {
      // An even number of jumps means the ring crosses and comes back; an odd
      // number means it wraps around a pole (Antarctica) and is left as is.
      let jumps = 0;
      for (let i = 1; i < ring.length; i++) if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) jumps++;
      if (jumps > 0 && jumps % 2 === 0) for (const pt of ring) if (pt[0] < 0) pt[0] += 360;
    }
  }
}

export function loadCountries() {
  if (!loading) {
    loading = fetch(new URL('geo/countries.json', document.baseURI))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((topo) => {
        const fc = feature(topo, topo.objects.countries);
        for (const f of fc.features) {
          fixAntimeridian(f.geometry);
          f.bbox = geometryBbox(f.geometry);
        }
        return fc;
      })
      .catch((e) => {
        loading = null;
        throw e;
      });
  }
  return loading;
}

/** Returns { iso2, iso3, name } for the country containing [lon, lat], or null. */
export async function countryAt(lon, lat) {
  try {
    const fc = await loadCountries();
    for (const f of fc.features) {
      const b = f.bbox;
      if (!b || lat < b[1] || lat > b[3]) continue;
      for (const x of [lon, lon + 360]) {
        if (x >= b[0] && x <= b[2] && geometryContainsPoint(f.geometry, [x, lat])) return f.properties;
      }
    }
  } catch {
    /* outlines unavailable */
  }
  return null;
}
