// Detail view for one incident or thermal detection (map popup + list/card expansion).
import { html, raw, safeUrl } from '../lib/dom.js';
import { fmtAgo, fmtCoords, fmtRelPos, fmtTime, countryName } from '../lib/format.js';
import { earthquakeBandLabel } from '../shared/severity.js';
import { iconDataUrl } from '../map/icons.js';
import { colorFor } from '../lib/colors.js';
import { activityState, lastActivityMs, ONGOING_HOURS } from '../lib/filters.js';

const FIRMS_DOCS = 'https://www.earthdata.nasa.gov/data/tools/firms/faq';

const row = (label, value) => (value == null || value === '' ? '' : html`<div class="kv"><dt>${label}</dt><dd>${value}</dd></div>`);

const timeHtml = (iso, now) =>
  iso ? html`<time datetime="${iso}">${fmtTime(iso)}</time> <span class="muted">(${fmtAgo(iso, now)})</span>` : null;

export function severityBadge(p) {
  const color = colorFor(p.severity?.colorHint);
  return html`<span class="sev-badge" style="--sev:${color}"><span class="sev-dot" aria-hidden="true"></span>${p.severity?.label || 'Not classified'}</span>`;
}

const SOURCE_NAMES = { disaster: 'GDACS', natural: 'NASA EONET' };

const ACTIVITY_LABELS = { ongoing: 'Ongoing', quiet: 'No recent update', ended: 'Ended' };

// Earthquakes happen at one moment: "ongoing" does not fit them, so they get no badge
// (they still fade on the map once they are more than a day old).
const hasActivity = (p) => Boolean(SOURCE_NAMES[p.category]) && p.subtype !== 'EQ';

/** Ongoing / No recent update / Ended — see activityState(). */
export function activityBadge(p, now = Date.now()) {
  if (!hasActivity(p)) return '';
  const state = activityState(p, now);
  return html`<span class="activity-badge is-${state}">${ACTIVITY_LABELS[state]}</span>`;
}

function activityRow(p, now) {
  if (!hasActivity(p)) return '';
  const src = SOURCE_NAMES[p.category];
  const what = p.category === 'natural' ? 'open' : 'current';
  const state = activityState(p, now);
  const last = lastActivityMs(p);
  const ago = last != null ? fmtAgo(new Date(last).toISOString(), now) : null;
  if (state === 'ended') return row('Status', `Ended — ${src} no longer lists this event as ${what}${ago ? ` (latest activity ${ago})` : ''}`);
  if (state === 'quiet') return row('Status', `No recent update — ${src} still lists this event as ${what}, but its latest ${p.category === 'natural' ? 'report' : 'assessment'} is ${ago ? `from ${ago}` : 'more than a day old'}. It may be easing or over.`);
  return row('Status', `Ongoing — ${src} lists this event as ${what} and updated it in the last ${ONGOING_HOURS} h`);
}

function relativeLine(p, origin, geometry) {
  if (!origin || geometry?.type !== 'Point') return '';
  const pos = fmtRelPos(origin, geometry.coordinates);
  if (p.locationPrecision === 'representative') return row('Representative location', `${pos} from the selected location (affected area may be broader)`);
  return row('From selected location', pos);
}

function earthquakeBody(f, now, origin) {
  const p = f.properties;
  const a = p.attributes || {};
  const [lon, lat] = f.geometry.coordinates;
  return html`
    ${row('Magnitude', `${p.severity.label}${a.magType ? ` (${a.magType})` : ''} · ${earthquakeBandLabel(p.severity.numeric)}`)}
    ${row('Event time', timeHtml(p.eventStartUtc, now))}
    ${row('Depth', a.depthKm == null ? null : `${a.depthKm} km`)}
    ${row('Location', `${p.regionText || ''} · ${fmtCoords(lon, lat)}`)}
    ${relativeLine(p, origin, f.geometry)}
    ${row('Tsunami flag (USGS)', a.tsunami ? 'Set — this flag alone does not mean a tsunami occurred; check official tsunami warning centres.' : 'Not set in source data')}
    ${row('PAGER alert', a.pagerAlert ? `${a.pagerAlert} (USGS estimated impact level)` : null)}
    ${row('USGS significance', a.significance == null ? null : `${a.significance}${a.significant ? ' (significant)' : ''}`)}
    ${row('Review status', a.reviewStatus)}
    ${row('Event type', a.eventType && a.eventType !== 'earthquake' ? a.eventType : null)}
    ${row('Source last updated', timeHtml(p.sourceUpdatedUtc, now))}
  `;
}

function disasterBody(f, now, origin) {
  const p = f.properties;
  const a = p.attributes || {};
  const countries = (p.countryCodes || []).map(countryName).join(', ') || p.regionText;
  return html`
    ${row('Hazard', a.hazardLabel)}
    ${row('GDACS alert level', a.alertLevel ? `${a.alertLevel}${a.alertScore != null ? ` (score ${a.alertScore})` : ''}` : 'Not supplied by source')}
    ${row('Severity (source)', a.severityText)}
    ${row('Population (source)', a.populationText)}
    ${activityRow(p, now)}
    ${row('Start', timeHtml(p.eventStartUtc, now))}
    ${row('Latest assessment covers until', timeHtml(p.eventEndUtc, now))}
    ${row('Countries / region', countries)}
    ${relativeLine(p, origin, f.geometry)}
    ${row('Geometry', p.affectedGeometry ? 'Affected area published by source (shown on map)' : p.locationPrecision === 'representative' ? 'Representative event location — affected area may be broader.' : 'Event location')}
    ${a.track ? row('Path', 'Dotted line on the map: the storm’s track as published by GDACS (past positions and forecast). Arrows point in the direction of travel.') : ''}
    ${row('Source last modified', timeHtml(p.sourceUpdatedUtc, now))}
    ${p.summary ? html`<p class="detail-summary">${p.summary}</p>` : ''}
  `;
}

function naturalBody(f, now, origin) {
  const p = f.properties;
  const a = p.attributes || {};
  const others = (a.originalSources || []).slice(1).filter((s) => safeUrl(s.url));
  return html`
    ${row('Event type', a.eventLabel)}
    ${activityRow(p, now)}
    ${row('Size / strength (source)', a.magnitude)}
    ${row('First reported', timeHtml(p.eventStartUtc, now))}
    ${row('Latest update', timeHtml(p.sourceUpdatedUtc, now))}
    ${relativeLine(p, origin, f.geometry)}
    ${row('Geometry', p.affectedGeometry ? 'Affected area published (shown on map)' : a.track ? `Latest of ${a.positions} reported positions. The dotted line is the path so far; arrows point in the direction of travel.` : p.locationPrecision === 'representative' ? 'Representative location — affected area may be broader.' : 'Event location')}
    ${others.length ? row('Other sources', html`${others.map((s, i) => html`${i ? ', ' : ''}<a href="${s.url}" target="_blank" rel="noopener noreferrer">${s.id}</a>`)}`) : ''}
  `;
}

function weatherBody(f, now) {
  const p = f.properties;
  const a = p.attributes || {};
  return html`
    ${row('Alert', a.event)}
    ${row('Severity', a.severity)}
    ${row('Urgency', a.urgency)}
    ${row('Certainty', a.certainty)}
    ${row('Effective', timeHtml(a.effectiveUtc, now))}
    ${row('Onset', timeHtml(a.onsetUtc, now))}
    ${row('Expires', timeHtml(a.expiresUtc, now))}
    ${row('Ends', timeHtml(a.endsUtc, now))}
    ${row('Areas', p.regionText)}
    ${row('Issued by', a.senderName)}
    ${row('Issued', timeHtml(p.sourceUpdatedUtc, now))}
    ${a.descriptionExcerpt ? html`<p class="detail-summary">${a.descriptionExcerpt}</p>` : ''}
  `;
}

function sourceFooter(p, linkLabel, now) {
  const url = safeUrl(p.sourceUrl);
  return html`
    ${p.disclaimer ? html`<p class="caveat">${p.disclaimer}</p>` : ''}
    <p class="detail-source">
      Source: ${p.attribution || p.source}${p.fetchedUtc ? html` · last fetched by this project ${fmtAgo(p.fetchedUtc, now)}` : ''}
    </p>
    ${url ? html`<a class="source-link" href="${url}" target="_blank" rel="noopener noreferrer">${linkLabel} ↗</a>` : ''}
  `;
}

const LINK_LABELS = {
  earthquake: 'View event on USGS',
  disaster: 'View GDACS event report',
  natural: 'Original source',
  weather: 'Official NWS alert record',
};

/** Detail element for a normalised incident Feature. */
export function incidentDetail(feature, { now = Date.now(), origin = null, onCheckLocation } = {}) {
  const p = feature.properties;
  const el = document.createElement('article');
  el.className = `incident-detail cat-${p.category}`;
  const iconType = p.category === 'disaster' || p.category === 'natural' ? p.subtype : null;
  const icon = iconType ? html`<img class="hazard-icon" src="${iconDataUrl(iconType)}" alt="" width="28" height="28">` : '';
  const BODIES = { earthquake: earthquakeBody, disaster: disasterBody, natural: naturalBody, weather: weatherBody };
  const body = (BODIES[p.category] || weatherBody)(feature, now, origin);
  el.innerHTML = html`
    <header class="detail-head">
      ${icon}
      <div>
        <p class="detail-kicker">${categoryKicker(p)}</p>
        <h3 class="detail-title">${p.title}</h3>
        ${severityBadge(p)} ${activityBadge(p, now)}
      </div>
    </header>
    <dl class="kv-list">${body}</dl>
    ${sourceFooter(p, LINK_LABELS[p.category] || 'Original source', now)}
    ${onCheckLocation ? raw('<button type="button" class="btn btn-small check-here">Check status around this location</button>') : ''}
  `.toString();
  if (onCheckLocation) {
    el.querySelector('.check-here').addEventListener('click', () => {
      const [lon, lat] = feature.geometry.type === 'Point' ? feature.geometry.coordinates : [null, null];
      onCheckLocation(lon, lat, feature);
    });
  }
  return el;
}

export function categoryKicker(p) {
  if (p.category === 'earthquake') return p.subtype && p.subtype !== 'earthquake' ? `Seismic event · ${p.subtype}` : 'Earthquake · USGS';
  if (p.category === 'disaster') return `${p.attributes?.hazardLabel || 'Disaster'} · GDACS alert`;
  if (p.category === 'natural') return `${p.attributes?.eventLabel || 'Natural event'} · NASA EONET`;
  if (p.category === 'weather') return 'Weather alert · NWS (US only)';
  return p.category;
}

/** Detail element for a decoded FIRMS detection (see firms-codec decodeRow). */
export function thermalDetail(d, { now = Date.now(), origin = null, onCheckLocation, fetchedUtc } = {}) {
  const el = document.createElement('article');
  el.className = 'incident-detail cat-thermal';
  const iso = new Date(d.timeMs).toISOString();
  el.innerHTML = html`
    <header class="detail-head">
      <div>
        <p class="detail-kicker">Satellite thermal detection · NASA FIRMS</p>
        <h3 class="detail-title">Active-fire / thermal hotspot detection</h3>
        <span class="sev-badge">Confidence: ${d.confidenceLabel}</span>
      </div>
    </header>
    <dl class="kv-list">
      ${row('Detected', timeHtml(iso, now))}
      ${row('Sensor', d.sensor)}
      ${row('Confidence', d.confidenceLabel)}
      ${row('Fire radiative power', d.frp == null ? null : `${d.frp} MW`)}
      ${row('Brightness temperature', d.brightness == null ? null : `${d.brightness} K`)}
      ${row('Day / night', d.dayNight)}
      ${row('Location', fmtCoords(d.lon, d.lat))}
      ${origin ? row('From selected location', fmtRelPos(origin, [d.lon, d.lat])) : ''}
    </dl>
    <p class="caveat">This is a satellite thermal anomaly, not a confirmed wildfire. It may be a wildfire, agricultural burning, an industrial heat source, a gas flare or another hot surface.</p>
    <p class="detail-source">Source: NASA FIRMS${fetchedUtc ? ` · last fetched by this project ${fmtAgo(fetchedUtc, now)}` : ''}</p>
    <a class="source-link" href="${FIRMS_DOCS}" target="_blank" rel="noopener noreferrer">About FIRMS detections ↗</a>
    ${onCheckLocation ? raw('<button type="button" class="btn btn-small check-here">Check status around this location</button>') : ''}
  `.toString();
  if (onCheckLocation) el.querySelector('.check-here').addEventListener('click', () => onCheckLocation(d.lon, d.lat));
  return el;
}
