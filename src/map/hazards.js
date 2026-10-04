// Hazard visual identity shared by the map, legends and popups: one colour per
// hazard type, used for its icon, its glow and its affected-area texture.
// These describe the kind of hazard only — severity stays with the source's
// own alert level (shown as the icon ring and in text).

export const HAZARDS = {
  flood: { label: 'Flood', color: '#2b7bd6', pattern: 'pixels' },
  storm: { label: 'Storm / cyclone / tornado', color: '#6a4fc9', pattern: 'wind' },
  wildfire: { label: 'Wildfire', color: '#e4561b', pattern: 'flames' },
  volcano: { label: 'Volcano', color: '#c62f1d', pattern: 'embers' },
  drought: { label: 'Drought', color: '#b8860b', pattern: 'cracks' },
  earthquake: { label: 'Earthquake', color: '#8a5212', pattern: 'zigzag' },
  tsunami: { label: 'Tsunami', color: '#0e7490', pattern: 'pixels' },
  landslide: { label: 'Landslide', color: '#7c5a3a', pattern: 'zigzag' },
  dust: { label: 'Dust and haze', color: '#a8865a', pattern: 'dots' },
  snow: { label: 'Snow / winter', color: '#5b9bd5', pattern: 'dots' },
  heat: { label: 'Temperature extreme', color: '#d9480f', pattern: 'dots' },
  other: { label: 'Other event', color: '#5f6977', pattern: 'dots' },
};

const GDACS = { FL: 'flood', TC: 'storm', WF: 'wildfire', VO: 'volcano', DR: 'drought', EQ: 'earthquake', TS: 'tsunami' };
const EONET = {
  floods: 'flood',
  severeStorms: 'storm',
  wildfires: 'wildfire',
  volcanoes: 'volcano',
  drought: 'drought',
  landslides: 'landslide',
  dustHaze: 'dust',
  snow: 'snow',
  tempExtremes: 'heat',
};

/** Hazard key for a GDACS code ("FL"), an EONET category ("floods") or a hazard key itself. */
export function hazardOf(code) {
  if (HAZARDS[code]) return code;
  return GDACS[code] || EONET[code] || 'other';
}

/** Hazard key for an NWS alert event name, or null when no texture applies. */
export function nwsHazard(event = '') {
  const e = String(event).toLowerCase();
  if (/tornado|hurricane|tropical|typhoon|wind|gale|storm surge|blizzard|thunderstorm/.test(e)) return 'storm';
  if (/flood/.test(e)) return 'flood';
  if (/fire|red flag/.test(e)) return 'wildfire';
  if (/heat/.test(e)) return 'heat';
  if (/winter|snow|ice|freeze|frost|cold|chill/.test(e)) return 'snow';
  if (/tsunami/.test(e)) return 'tsunami';
  if (/dust|smoke/.test(e)) return 'dust';
  return null;
}

export const hazardColor = (key) => (HAZARDS[key] || HAZARDS.other).color;
