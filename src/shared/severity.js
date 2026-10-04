// Display classifications. These only map values the source itself supplies
// (magnitude, GDACS alert level, NWS severity) to a colour hint — the project
// never invents its own severity score.

/** USGS magnitude → colour hint. */
export function earthquakeColorHint(mag) {
  if (!Number.isFinite(mag)) return 'gray';
  if (mag >= 6) return 'red';
  if (mag >= 5) return 'orange';
  if (mag >= 3) return 'yellow';
  return 'blue';
}

export function earthquakeBandLabel(mag) {
  if (!Number.isFinite(mag)) return 'Unknown magnitude';
  if (mag >= 6) return 'M 6+';
  if (mag >= 5) return 'M 5–5.9';
  if (mag >= 3) return 'M 3–4.9';
  return 'Below M 3';
}

/** GDACS alert level as published (Green / Orange / Red) → colour hint, else null. */
export function gdacsColorHint(level) {
  const l = String(level || '').toLowerCase();
  return ['green', 'orange', 'red'].includes(l) ? l : null;
}

export const NWS_SEVERITIES = ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'];

export function nwsColorHint(severity) {
  switch (severity) {
    case 'Extreme':
      return 'red';
    case 'Severe':
      return 'orange';
    case 'Moderate':
      return 'yellow';
    case 'Minor':
      return 'blue';
    default:
      return 'gray';
  }
}

/** Rank used only for sorting (higher first). */
export function nwsSeverityRank(severity) {
  const i = NWS_SEVERITIES.indexOf(severity);
  return i === -1 ? 0 : NWS_SEVERITIES.length - i;
}

export function gdacsLevelRank(level) {
  return { red: 3, orange: 2, green: 1 }[String(level || '').toLowerCase()] ?? 0;
}

export const GDACS_TYPES = {
  EQ: 'Earthquake',
  TC: 'Tropical cyclone',
  FL: 'Flood',
  VO: 'Volcano',
  DR: 'Drought',
  WF: 'Wildfire',
  TS: 'Tsunami',
};

/** NASA EONET event categories shown on the map (earthquakes come from USGS; sea/lake ice excluded). */
export const NATURAL_TYPES = {
  wildfires: 'Wildfire',
  severeStorms: 'Severe storm',
  volcanoes: 'Volcano',
  floods: 'Flood',
  landslides: 'Landslide',
  drought: 'Drought',
  dustHaze: 'Dust and haze',
  snow: 'Snow',
  tempExtremes: 'Temperature extreme',
  manmade: 'Human-made event',
  waterColor: 'Water colour',
};


/** Hazards whose GDACS coordinate is a specific location rather than a broad area. */
export const GDACS_POINT_HAZARDS = new Set(['EQ', 'VO']);

/** USGS "significant" threshold, matching the USGS significant-earthquakes feeds. */
export const USGS_SIGNIFICANCE_THRESHOLD = 600;
