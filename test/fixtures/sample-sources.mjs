// Deterministic SAMPLE payloads that mimic each source's raw format.
// They are used to (1) build data/fixtures so the site runs locally without
// network access and (2) drive the unit tests. Every title is prefixed with
// "[Sample]" and the manifest is flagged mode: "fixture" so the UI shows a
// demo-data banner. These are NOT real incidents.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r4 = (v) => Math.round(v * 10000) / 10000;

// --- USGS --------------------------------------------------------------------

const NAMED_QUAKES = [
  // lon, lat, mag, depth, place, ageMinutes, sig, tsunami, alert
  [121.71, 23.97, 6.1, 18, '22 km E of Hualien City, Taiwan', 300, 720, 1, 'yellow'],
  [-70.86, -33.12, 5.2, 95, '38 km N of Santiago, Chile', 1500, 420, 0, null],
  [142.62, 38.14, 4.7, 40, 'off the east coast of Honshu, Japan', 38, 340, 0, null],
  [13.37, 42.38, 3.4, 9, "5 km NW of L'Aquila, Italy", 610, 178, 0, null],
  [-118.12, 34.08, 3.2, 12, '6 km N of Alhambra, CA', 95, 158, 0, null],
  [-117.9, 33.95, 2.1, 8, '3 km S of La Habra, CA', 20, 68, 0, null],
  [-118.45, 34.3, 1.6, 6, '4 km NE of San Fernando, CA', 300, 39, 0, null],
  [97.85, 2.56, 5.6, 30, '58 km SW of Sinabang, Indonesia', 4300, 482, 0, 'green'],
  [126.4, 3.9, 4.9, 60, 'Talaud Islands, Indonesia', 2200, 369, 0, null],
  [36.9, 37.6, 4.3, 7, '12 km E of Kahramanmaraş, Türkiye', 900, 284, 0, null],
  [-96.9, 16.1, 5.0, 45, '20 km S of San Pedro Pochutla, Mexico', 6200, 385, 0, null],
  [-22.3, 63.87, 3.1, 4, '4 km NE of Grindavík, Iceland', 180, 148, 0, null],
  [176.1, -38.6, 4.5, 140, '25 km SE of Taupō, New Zealand', 8000, 312, 0, null],
  [-76.4, -11.9, 4.6, 70, '33 km E of Lima, Peru', 3100, 326, 0, null],
  [-155.28, 19.41, 2.4, 2, '5 km SW of Volcano, Hawaii', 50, 89, 0, null],
];

export function sampleUsgs(now) {
  const rand = rng(42);
  const features = NAMED_QUAKES.map(([lon, lat, mag, depth, place, age, sig, tsunami, alert], i) => ({
    type: 'Feature',
    id: `sample${String(i).padStart(4, '0')}`,
    properties: {
      mag,
      place,
      time: now - age * MIN,
      updated: now - age * MIN + 20 * MIN,
      url: 'https://earthquake.usgs.gov/earthquakes/map/',
      felt: mag > 4 ? Math.round(mag * 30) : null,
      mmi: mag > 4.5 ? mag - 1 : null,
      alert,
      status: age > 120 ? 'reviewed' : 'automatic',
      tsunami,
      sig,
      net: 'us',
      magType: mag >= 4 ? 'mww' : 'ml',
      type: 'earthquake',
      title: `[Sample] M ${mag.toFixed(1)} - ${place}`,
    },
    geometry: { type: 'Point', coordinates: [lon, lat, depth] },
  }));
  // Small background events in seismically active regions.
  const regions = [
    [-122, 37.5, 2.5, 'Northern California'],
    [-116.5, 33.5, 2, 'Southern California'],
    [-150, 61.5, 3, 'Southern Alaska'],
    [-66.8, 18.0, 1.5, 'Puerto Rico region'],
    [-117.5, 38.5, 2, 'Nevada'],
  ];
  for (let i = 0; i < 30; i++) {
    const [lon, lat, spread, label] = regions[i % regions.length];
    const mag = Math.round((0.8 + rand() * 2.4) * 10) / 10;
    const age = Math.round(rand() * 7 * 24 * 60);
    features.push({
      type: 'Feature',
      id: `samplebg${String(i).padStart(3, '0')}`,
      properties: {
        mag,
        place: `${label}`,
        time: now - age * MIN,
        updated: now - age * MIN + 5 * MIN,
        url: 'https://earthquake.usgs.gov/earthquakes/map/',
        alert: null,
        status: 'automatic',
        tsunami: 0,
        sig: Math.round(mag * 20),
        net: 'ci',
        magType: 'ml',
        type: i === 7 ? 'quarry blast' : 'earthquake',
        title: `[Sample] M ${mag.toFixed(1)} - ${label}`,
      },
      geometry: {
        type: 'Point',
        coordinates: [r4(lon + (rand() - 0.5) * spread), r4(lat + (rand() - 0.5) * spread), Math.round(rand() * 20 * 10) / 10],
      },
    });
  }
  return {
    type: 'FeatureCollection',
    metadata: { generated: now - 2 * MIN, title: 'SAMPLE USGS All Earthquakes, Past Week', status: 200, count: features.length },
    features,
  };
}

// --- GDACS -------------------------------------------------------------------

function circle(lon, lat, radiusDeg, n = 24, squash = 1) {
  const ring = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    ring.push([r4(lon + Math.cos(a) * radiusDeg), r4(lat + Math.sin(a) * radiusDeg * squash)]);
  }
  ring[n] = ring[0];
  return { type: 'Polygon', coordinates: [ring] };
}

const iso = (ms) => new Date(ms).toISOString().slice(0, 19); // GDACS style: no "Z"

function gdacsProps(now, o) {
  return {
    eventtype: o.type,
    eventid: o.id,
    episodeid: o.episode ?? 1,
    eventname: o.eventname ?? '',
    name: `[Sample] ${o.name}`,
    description: o.description,
    htmldescription: o.description,
    alertlevel: o.level,
    alertscore: o.score ?? 1,
    episodealertlevel: o.level,
    istemporary: 'false',
    iscurrent: o.current === false ? 'false' : 'true',
    country: o.country,
    fromdate: iso(now - o.startAgo),
    todate: iso(now - (o.endAgo ?? 0)),
    datemodified: iso(now - (o.modifiedAgo ?? 30 * MIN)),
    iso3: o.iso3,
    affectedcountries: o.countries,
    severitydata: o.severity,
    url: {
      report: `https://www.gdacs.org/report.aspx?eventtype=${o.type}&eventid=${o.id}`,
      details: `https://www.gdacs.org/gdacsapi/api/events/geteventdata?eventtype=${o.type}&eventid=${o.id}`,
    },
    Class: o.cls ?? 'Point_Centroid',
  };
}

export function sampleGdacs(now) {
  const f = (geometry, props) => ({ type: 'Feature', geometry, properties: props });
  const events = [
    {
      type: 'EQ', id: 900001, level: 'Orange', score: 2, name: 'Earthquake in Taiwan',
      description: 'Sample: magnitude 6.1 earthquake near the east coast of Taiwan.',
      country: 'Taiwan', iso3: 'TWN', countries: [{ iso2: 'TW', iso3: 'TWN', countryname: 'Taiwan' }],
      severity: { severity: 6.1, severitytext: 'Magnitude 6.1M, Depth:18km', severityunit: 'M' },
      startAgo: 300 * MIN, endAgo: 300 * MIN, point: [121.71, 23.97], polygons: [circle(121.71, 23.97, 0.6)],
    },
    {
      type: 'TC', id: 900002, level: 'Orange', score: 2, name: 'Tropical Cyclone SAMPLE-KAI',
      description: 'Sample: tropical cyclone moving north-west towards northern Luzon.',
      country: 'Philippines', iso3: 'PHL', countries: [{ iso2: 'PH', iso3: 'PHL', countryname: 'Philippines' }],
      severity: { severity: 150, severitytext: 'Maximum wind speed of 150 km/h', severityunit: 'km/h' },
      startAgo: 3 * DAY, point: [127.5, 16.0],
      polygons: [circle(127.5, 16.0, 3.2, 32, 0.85)],
      lines: [{ type: 'LineString', coordinates: [[136.0, 11.5], [133.2, 13.0], [130.1, 14.6], [127.5, 16.0], [124.6, 17.6], [121.8, 19.4]] }],
    },
    {
      type: 'FL', id: 900003, level: 'Orange', score: 2, name: 'Flood in Bangladesh',
      description: 'Sample: riverine flooding reported in several districts.',
      country: 'Bangladesh', iso3: 'BGD', countries: [{ iso2: 'BD', iso3: 'BGD', countryname: 'Bangladesh' }],
      severity: { severity: 0, severitytext: 'Magnitude 0', severityunit: '' },
      startAgo: 5 * DAY, point: [90.4, 24.0],
    },
    {
      type: 'VO', id: 900004, level: 'Green', score: 1, name: 'Volcanic activity — Semeru, Indonesia',
      description: 'Sample: elevated volcanic activity.',
      country: 'Indonesia', iso3: 'IDN', countries: [{ iso2: 'ID', iso3: 'IDN', countryname: 'Indonesia' }],
      severity: { severity: 0, severitytext: '', severityunit: '' },
      startAgo: 2 * DAY, point: [112.92, -8.11],
    },
    {
      type: 'DR', id: 900005, level: 'Green', score: 1, name: 'Drought in the Horn of Africa',
      description: 'Sample: prolonged drought conditions affecting several countries.',
      country: 'Kenya, Somalia, Ethiopia', iso3: 'KEN,SOM,ETH',
      countries: [
        { iso2: 'KE', iso3: 'KEN', countryname: 'Kenya' },
        { iso2: 'SO', iso3: 'SOM', countryname: 'Somalia' },
        { iso2: 'ET', iso3: 'ETH', countryname: 'Ethiopia' },
      ],
      severity: { severity: 0, severitytext: '', severityunit: '' },
      startAgo: 60 * DAY, point: [41.0, 3.5],
    },
    {
      type: 'WF', id: 900006, level: 'Green', score: 1, name: 'Forest fire in Canada',
      description: 'Sample: wildfire in southern British Columbia.',
      country: 'Canada', iso3: 'CAN', countries: [{ iso2: 'CA', iso3: 'CAN', countryname: 'Canada' }],
      severity: { severity: 1200, severitytext: 'Burned area 1200 ha', severityunit: 'ha' },
      startAgo: 4 * DAY, point: [-120.5, 50.7], polygons: [circle(-120.5, 50.7, 0.15, 16, 0.7)],
    },
    {
      type: 'EQ', id: 900007, level: 'Green', score: 1, name: 'Old earthquake (should be filtered out)',
      description: 'Sample: ended long ago.', country: 'Peru', iso3: 'PER',
      countries: [{ iso2: 'PE', iso3: 'PER', countryname: 'Peru' }],
      severity: { severity: 4.8, severitytext: 'Magnitude 4.8M', severityunit: 'M' },
      startAgo: 45 * DAY, endAgo: 45 * DAY, current: false, point: [-75.5, -12.5],
    },
  ];
  const features = [];
  for (const e of events) {
    features.push(f({ type: 'Point', coordinates: e.point }, gdacsProps(now, e)));
    for (const p of e.polygons || []) features.push(f(p, gdacsProps(now, { ...e, cls: `Poly_${e.level}` })));
    for (const l of e.lines || []) features.push(f(l, gdacsProps(now, { ...e, cls: 'Line_Line_' })));
  }
  // Affected area for the Bangladesh flood, as the GDACS geometry endpoint would supply it.
  const geometries = {
    'FL:900003:1': {
      polygons: [{ type: 'Polygon', coordinates: [[[89.5, 23.3], [91.0, 23.3], [91.0, 24.8], [89.5, 24.8], [89.5, 23.3]]] }],
      lines: [],
      fetchedUtc: new Date(now - HOUR).toISOString(),
    },
  };
  return { format: 'geojson', endpoint: 'sample', data: { type: 'FeatureCollection', features }, geometries };
}

/** A small GDACS GeoRSS document for the fallback parser. */
export function sampleGdacsRss(now) {
  const d = new Date(now - 2 * HOUR).toUTCString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:gdacs="http://www.gdacs.org" xmlns:geo="http://www.w3.org/2003/01/geo/wgs84_pos#" xmlns:georss="http://www.georss.org/georss" version="2.0">
<channel><title>GDACS sample</title>
<item>
  <title>[Sample] Green flood alert in Nigeria</title>
  <description><![CDATA[Sample flood &amp; rain event]]></description>
  <link>https://www.gdacs.org/report.aspx?eventtype=FL&amp;eventid=910001</link>
  <pubDate>${d}</pubDate>
  <gdacs:fromdate>${d}</gdacs:fromdate>
  <gdacs:todate>${d}</gdacs:todate>
  <gdacs:eventtype>FL</gdacs:eventtype>
  <gdacs:alertlevel>Green</gdacs:alertlevel>
  <gdacs:eventid>910001</gdacs:eventid>
  <gdacs:episodeid>2</gdacs:episodeid>
  <gdacs:severity unit="" value="0">Magnitude 0</gdacs:severity>
  <gdacs:country>Nigeria</gdacs:country>
  <gdacs:iso3>NGA</gdacs:iso3>
  <gdacs:iscurrent>true</gdacs:iscurrent>
  <geo:Point><geo:lat>9.08</geo:lat><geo:long>7.49</geo:long></geo:Point>
</item>
<item>
  <title>[Sample] Orange earthquake alert in Greece</title>
  <link>https://www.gdacs.org/report.aspx?eventtype=EQ&amp;eventid=910002</link>
  <gdacs:fromdate>${d}</gdacs:fromdate>
  <gdacs:eventtype>EQ</gdacs:eventtype>
  <gdacs:alertlevel>Orange</gdacs:alertlevel>
  <gdacs:eventid>910002</gdacs:eventid>
  <gdacs:iso3>GRC</gdacs:iso3>
  <georss:point>38.2 23.1</georss:point>
</item>
</channel></rss>`;
}

// --- NASA FIRMS ----------------------------------------------------------------

const FIRE_CLUSTERS = [
  // lon, lat, spreadDeg, count, label
  [-117.6, 34.25, 0.25, 70],
  [-63.0, -10.5, 2.5, 700],
  [22.0, 5.0, 3.0, 600],
  [132.0, -14.0, 2.0, 350],
  [125.0, 62.0, 1.5, 220],
  [75.5, 30.5, 1.2, 300],
  [50.15, 26.3, 0.05, 25], // persistent industrial heat source (gas flare)
  [-120.5, 50.7, 0.1, 40],
];

const pad4 = (n) => String(n).padStart(4, '0');

export function sampleFirms(now) {
  const rand = rng(7);
  const viirs = ['latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight'];
  const modis = ['latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight'];
  for (const [lon, lat, spread, count] of FIRE_CLUSTERS) {
    for (let i = 0; i < count; i++) {
      // Bias toward recent detections.
      const ageMs = Math.floor(rand() ** 1.6 * 7 * DAY);
      const t = new Date(now - ageMs);
      const date = t.toISOString().slice(0, 10);
      const time = pad4(t.getUTCHours() * 100 + t.getUTCMinutes());
      const la = (lat + (rand() - 0.5) * spread * 2).toFixed(5);
      const lo = (lon + (rand() - 0.5) * spread * 2).toFixed(5);
      const frp = (rand() ** 2 * 80 + 0.5).toFixed(2);
      const dn = t.getUTCHours() % 24 < 12 ? 'D' : 'N';
      if (rand() < 0.7) {
        const conf = rand() < 0.15 ? 'l' : rand() < 0.75 ? 'n' : 'h';
        viirs.push(`${la},${lo},${(300 + rand() * 60).toFixed(2)},0.4,0.4,${date},${time},N20,VIIRS,${conf},2.0NRT,${(280 + rand() * 20).toFixed(2)},${frp},${dn}`);
      } else {
        const conf = Math.round(rand() * 100);
        modis.push(`${la},${lo},${(310 + rand() * 50).toFixed(1)},1.0,1.0,${date},${Number(time)},${rand() < 0.5 ? 'T' : 'A'},MODIS,${conf},6.1NRT,${(290 + rand() * 15).toFixed(1)},${frp},${dn}`);
      }
    }
  }
  return {
    mode: 'sample',
    parts: [
      { product: 'VIIRS_NOAA20_NRT', csv: [viirs.join('\n')] },
      { product: 'MODIS_NRT', csv: [modis.join('\n')] },
    ],
  };
}

// --- NWS -------------------------------------------------------------------------

function rect(minLon, minLat, maxLon, maxLat) {
  return {
    type: 'Polygon',
    coordinates: [[[minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat], [minLon, minLat]]],
  };
}

function nwsAlert(now, o) {
  const id = `urn:oid:2.49.0.1.840.0.sample.${o.n}`;
  return {
    id: `https://api.weather.gov/alerts/${id}`,
    type: 'Feature',
    geometry: o.geometry ?? null,
    properties: {
      '@id': `https://api.weather.gov/alerts/${id}`,
      id,
      areaDesc: o.area,
      affectedZones: o.zones ?? [],
      sent: new Date(now - (o.sentAgo ?? 30 * MIN)).toISOString(),
      effective: new Date(now - (o.sentAgo ?? 30 * MIN)).toISOString(),
      onset: new Date(now - (o.onsetAgo ?? 30 * MIN)).toISOString(),
      expires: new Date(now + o.expiresIn).toISOString(),
      ends: o.endsIn == null ? null : new Date(now + o.endsIn).toISOString(),
      status: 'Actual',
      messageType: 'Alert',
      category: 'Met',
      severity: o.severity,
      certainty: o.certainty ?? 'Likely',
      urgency: o.urgency ?? 'Expected',
      event: o.event,
      senderName: o.sender,
      headline: `[Sample] ${o.event} issued for ${o.area}`,
      description: `SAMPLE ALERT. ${o.event} for ${o.area}. This is demonstration data, not a real alert.`,
      response: 'Monitor',
    },
  };
}

export function sampleNws(now) {
  const phxZone = 'https://api.weather.gov/zones/forecast/AZZ540';
  const alerts = [
    nwsAlert(now, { n: 1, event: 'Flood Warning', severity: 'Severe', area: 'Harris, TX', sender: 'NWS Houston/Galveston TX', geometry: rect(-95.8, 29.5, -95.0, 30.1), expiresIn: 6 * HOUR, urgency: 'Immediate', certainty: 'Observed' }),
    nwsAlert(now, { n: 2, event: 'Heat Advisory', severity: 'Moderate', area: 'Greater Phoenix Area, AZ', sender: 'NWS Phoenix AZ', zones: [phxZone], expiresIn: 10 * HOUR }),
    nwsAlert(now, { n: 3, event: 'Winter Weather Advisory', severity: 'Minor', area: 'Central Colorado Mountains', sender: 'NWS Boulder CO', geometry: rect(-106.8, 38.8, -105.6, 39.8), expiresIn: 18 * HOUR }),
    nwsAlert(now, { n: 4, event: 'Tornado Warning', severity: 'Extreme', area: 'Oklahoma, OK', sender: 'NWS Norman OK', geometry: rect(-97.7, 35.35, -97.35, 35.6), expiresIn: 40 * MIN, urgency: 'Immediate', certainty: 'Observed' }),
    nwsAlert(now, { n: 5, event: 'Wind Advisory', severity: 'Minor', area: 'Expired sample', sender: 'NWS', geometry: rect(-90, 40, -89, 41), expiresIn: -2 * HOUR }),
    nwsAlert(now, { n: 6, event: 'Special Weather Statement', severity: 'Moderate', area: 'Zone without cached outline', sender: 'NWS', zones: ['https://api.weather.gov/zones/forecast/MTZ999'], expiresIn: 3 * HOUR }),
  ];
  return {
    alerts: { type: 'FeatureCollection', updated: new Date(now - 3 * MIN).toISOString(), features: alerts },
    zones: { [phxZone]: { geometry: rect(-112.6, 33.2, -111.5, 33.85), fetchedUtc: new Date(now - DAY).toISOString() } },
    pendingZones: 0,
  };
}

// --- NASA EONET -------------------------------------------------------------------

export function sampleEonet(now) {
  const t = (ago) => new Date(now - ago).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const ev = (id, title, cat, geometry, extra = {}) => ({
    id,
    title: `[Sample] ${title}`,
    description: null,
    link: `https://eonet.gsfc.nasa.gov/api/v3/events/${id}`,
    closed: null,
    categories: [{ id: cat, title: cat }],
    sources: [{ id: 'SAMPLE', url: 'https://eonet.gsfc.nasa.gov/' }],
    geometry,
    ...extra,
  });
  return {
    title: 'EONET Events (sample)',
    events: [
      ev('EONET_S1', 'Ridge Fire, Los Angeles County, California', 'wildfires', [
        { magnitudeValue: 850, magnitudeUnit: 'acres', date: t(30 * HOUR), type: 'Point', coordinates: [-118.05, 34.42] },
        { magnitudeValue: 2300, magnitudeUnit: 'acres', date: t(4 * HOUR), type: 'Point', coordinates: [-118.05, 34.42] },
      ]),
      ev('EONET_S2', 'Hurricane SAMPLE-ALBA', 'severeStorms', [
        { magnitudeValue: 75, magnitudeUnit: 'kts', date: t(3 * DAY), type: 'Point', coordinates: [-62.0, 17.0] },
        { magnitudeValue: 95, magnitudeUnit: 'kts', date: t(2 * DAY), type: 'Point', coordinates: [-66.5, 19.2] },
        { magnitudeValue: 110, magnitudeUnit: 'kts', date: t(1 * DAY), type: 'Point', coordinates: [-71.0, 21.8] },
        { magnitudeValue: 105, magnitudeUnit: 'kts', date: t(3 * HOUR), type: 'Point', coordinates: [-74.6, 24.5] },
      ]),
      ev('EONET_S3', 'Etna Volcano, Italy', 'volcanoes', [{ date: t(5 * DAY), type: 'Point', coordinates: [14.99, 37.75] }]),
      ev('EONET_S4', 'Floods in the Po Valley, Italy', 'floods', [
        { date: t(2 * DAY), type: 'Polygon', coordinates: [[[10.5, 44.8], [12.2, 44.8], [12.2, 45.3], [10.5, 45.3], [10.5, 44.8]]] },
      ]),
      ev('EONET_S5', 'Sample earthquake (excluded — USGS is used)', 'earthquakes', [{ date: t(HOUR), type: 'Point', coordinates: [0, 0] }]),
      ev('EONET_S6', 'Iceberg A99 (excluded)', 'seaLakeIce', [{ date: t(HOUR), type: 'Point', coordinates: [-40, -70] }]),
    ],
  };
}

export const SAMPLE_BUILDERS = {
  'usgs-earthquakes': sampleUsgs,
  'gdacs-disasters': sampleGdacs,
  'firms-hotspots': sampleFirms,
  'nws-alerts': sampleNws,
  'eonet-events': sampleEonet,
};
