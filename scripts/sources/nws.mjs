// U.S. National Weather Service — active alerts (United States and territories only).
// https://www.weather.gov/documentation/services-web-api
//
// Many alerts are zone-based and have no polygon of their own. Their zone
// outlines are fetched from the NWS zones API, simplified, and cached in
// cache/nws-zones.json so later runs only fetch zones they have not seen.

import { makeIncident } from '../../src/shared/schema.js';
import { parseUtc, toIsoUtc } from '../../src/shared/time.js';
import { mergePolygons, simplifyGeometry } from '../../src/shared/geo.js';
import { nwsColorHint, nwsSeverityRank } from '../../src/shared/severity.js';
import { mapLimit } from '../lib/http.js';

export const key = 'nws-alerts';
const ALERTS_URL = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert,update';
const ZONE_CACHE = 'cache/nws-zones.json';
const ZONE_CACHE_MAX_AGE_DAYS = 30;

const nwsHeaders = () => ({
  Accept: 'application/geo+json',
  // NWS asks API clients to identify themselves with contact information.
  'User-Agent':
    process.env.NWS_USER_AGENT ||
    `(GlobalIncidentMap, https://github.com/${process.env.GITHUB_REPOSITORY || 'global-incident-map'})`,
});

export async function fetchRaw(ctx) {
  const alerts = await ctx.fetchJson(process.env.NWS_ALERTS_URL || ALERTS_URL, {
    headers: nwsHeaders(),
    timeoutMs: 90_000,
  });
  if (alerts?.type !== 'FeatureCollection') throw new Error('NWS response is not a FeatureCollection');

  const cache = (await ctx.readPrevious(ZONE_CACHE))?.zones || {};
  const wanted = new Set();
  for (const f of alerts.features || []) {
    if (f.geometry) continue;
    for (const z of f.properties?.affectedZones || []) if (!cache[z]) wanted.add(z);
  }
  const maxFetches = Number(process.env.NWS_MAX_ZONE_FETCHES) || 250;
  const toFetch = [...wanted].sort().slice(0, maxFetches);
  let failedZones = 0;
  await mapLimit(toFetch, 4, async (url) => {
    if (!/^https:\/\/api\.weather\.gov\/zones\//.test(url)) return;
    try {
      const zone = await ctx.fetchJson(url, { headers: nwsHeaders(), timeoutMs: 30_000, retries: 1 });
      // Cache zones without geometry too, so they are not re-requested every run.
      cache[url] = { geometry: simplifyGeometry(zone.geometry, 0.01, 3), fetchedUtc: ctx.nowIso };
    } catch {
      failedZones++;
    }
  });
  if (toFetch.length) ctx.log(`  NWS zones: fetched ${toFetch.length - failedZones}/${toFetch.length}, ${wanted.size - toFetch.length} deferred`);
  return { alerts, zones: cache, pendingZones: Math.max(0, wanted.size - toFetch.length) + failedZones };
}

export function normalize(raw, ctx) {
  const fetchedUtc = ctx.nowIso;
  const features = [];
  let unplaced = 0;
  const usedZones = new Set();
  // The NWS active-alerts list occasionally contains the same alert twice (e.g. when
  // alerts change while it is being paged). Keep one copy: duplicate ids would fail
  // validation and freeze this source on its previous data.
  const seenIds = new Set();
  for (const f of raw.alerts.features || []) {
    const p = f.properties || {};
    const expires = parseUtc(p.ends) ?? parseUtc(p.expires);
    if (expires != null && expires < ctx.now) continue;
    let geometry = f.geometry ? simplifyGeometry(f.geometry, 0.005, 3) : null;
    let precision = 'area';
    if (!geometry) {
      const zoneGeoms = [];
      for (const z of p.affectedZones || []) {
        if (raw.zones[z]) usedZones.add(z);
        if (raw.zones[z]?.geometry) zoneGeoms.push(raw.zones[z].geometry);
      }
      geometry = mergePolygons(zoneGeoms);
      precision = 'zone';
    }
    if (!geometry) {
      unplaced++;
      continue;
    }
    const id = String(p.id || f.id || '').trim();
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    const severity = p.severity || 'Unknown';
    features.push(
      makeIncident({
        id: `nws:${id}`,
        source: 'NWS',
        sourceKey: key,
        sourceUrl: p['@id'] || f.id || null,
        category: 'weather',
        subtype: p.event || 'Weather alert',
        title: p.headline || p.event || 'Weather alert',
        summary: `${p.event || 'Alert'} for ${p.areaDesc || 'listed areas'}`,
        severity: { label: severity, numeric: nwsSeverityRank(severity), sourceLevel: severity, colorHint: nwsColorHint(severity) },
        geometry,
        locationPrecision: precision,
        eventStartUtc: toIsoUtc(p.onset) ?? toIsoUtc(p.effective),
        eventEndUtc: toIsoUtc(p.ends) ?? toIsoUtc(p.expires),
        sourceUpdatedUtc: toIsoUtc(p.sent),
        fetchedUtc,
        countryCodes: ['US'],
        regionText: p.areaDesc || null,
        attributes: {
          event: p.event || null,
          severity,
          urgency: p.urgency || null,
          certainty: p.certainty || null,
          effectiveUtc: toIsoUtc(p.effective),
          onsetUtc: toIsoUtc(p.onset),
          expiresUtc: toIsoUtc(p.expires),
          endsUtc: toIsoUtc(p.ends),
          messageType: p.messageType || null,
          response: p.response || null,
          senderName: p.senderName || null,
          descriptionExcerpt: p.description ? `${String(p.description).replace(/\s+/g, ' ').slice(0, 400)}${p.description.length > 400 ? '…' : ''}` : null,
          zoneBased: precision === 'zone',
        },
        disclaimer:
          precision === 'zone'
            ? 'Drawn from simplified NWS zone outlines; boundaries are approximate. Follow official NWS and local instructions.'
            : 'Follow official NWS and local authority instructions.',
        attribution: 'NOAA / National Weather Service',
      }),
    );
  }
  // Most severe first, then newest, then id — deterministic.
  features.sort(
    (a, b) =>
      b.properties.severity.numeric - a.properties.severity.numeric ||
      (parseUtc(b.properties.sourceUpdatedUtc) ?? 0) - (parseUtc(a.properties.sourceUpdatedUtc) ?? 0) ||
      (a.id < b.id ? -1 : 1),
  );

  // Keep the zone cache bounded: drop entries not used recently.
  const zones = {};
  const cutoff = ctx.now - ZONE_CACHE_MAX_AGE_DAYS * 86_400_000;
  for (const [url, z] of Object.entries(raw.zones).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (usedZones.has(url)) zones[url] = { ...z, lastUsedUtc: fetchedUtc };
    else if ((parseUtc(z.lastUsedUtc ?? z.fetchedUtc) ?? 0) >= cutoff) zones[url] = z;
  }

  const latestSent = features.map((f) => parseUtc(f.properties.sourceUpdatedUtc)).filter(Boolean).sort((a, b) => b - a)[0];
  const pending = unplaced;
  return {
    records: features.length,
    minExpectedRecords: 0,
    sourceLatestDataTimeUtc: toIsoUtc(raw.alerts.updated) ?? toIsoUtc(latestSent) ?? null,
    sourceLastEventTimeUtc: toIsoUtc(latestSent) ?? null,
    notes: pending
      ? `${pending} active alert(s) could not be drawn yet because their zone outlines have not been fetched; they will appear after later refreshes.`
      : null,
    extraMeta: { unplacedAlerts: unplaced },
    files: {
      [`incidents/${key}.json`]: {
        type: 'FeatureCollection',
        sourceKey: key,
        fetchedUtc,
        coverage: 'United States and territories only',
        disclaimer: 'Alerts may be issued, updated or cancelled between project refreshes. Follow official NWS instructions.',
        features,
      },
      [ZONE_CACHE]: { zones },
    },
  };
}
