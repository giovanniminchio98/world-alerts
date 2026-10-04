// Shareable state in the URL: ?lat=&lon=&r=&w=&place=&cc=  and  #map=zoom/lat/lon
const RADII = [25, 50, 100, 250, 500];

export function readUrlState(loc = window.location) {
  const q = new URLSearchParams(loc.search);
  const out = {};
  const lat = Number(q.get('lat'));
  const lon = Number(q.get('lon'));
  if (q.has('lat') && q.has('lon') && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    out.selection = {
      lat,
      lon,
      name: q.get('place')?.slice(0, 120) || null,
      countryCode: /^[A-Za-z]{2}$/.test(q.get('cc') || '') ? q.get('cc').toUpperCase() : null,
      radiusKm: RADII.includes(Number(q.get('r'))) ? Number(q.get('r')) : 100,
    };
  }
  if (['1h', '24h', '48h', '7d'].includes(q.get('w'))) out.window = q.get('w');
  const m = /map=([\d.]+)\/(-?[\d.]+)\/(-?[\d.]+)/.exec(loc.hash);
  if (m) out.view = { zoom: Number(m[1]), center: [Number(m[3]), Number(m[2])] };
  return out;
}

export function buildUrl({ selection, window: w, view } = {}, loc = window.location) {
  const url = new URL(loc.href);
  const q = new URLSearchParams();
  if (selection) {
    q.set('lat', selection.lat.toFixed(4));
    q.set('lon', selection.lon.toFixed(4));
    q.set('r', String(selection.radiusKm));
    if (selection.name) q.set('place', selection.name);
    if (selection.countryCode) q.set('cc', selection.countryCode);
  }
  if (w && w !== '24h') q.set('w', w);
  url.search = q.toString();
  url.hash = view ? `map=${view.zoom.toFixed(2)}/${view.center[1].toFixed(4)}/${view.center[0].toFixed(4)}` : '';
  return url.toString();
}

export function writeUrlState(state) {
  try {
    history.replaceState(null, '', buildUrl(state));
  } catch {
    /* ignore (e.g. sandboxed iframe) */
  }
}

export const RADIUS_OPTIONS = RADII;
