// Location Status card: what the connected sources report around a selected place.
import { html, raw, setHtml } from '../lib/dom.js';
import { fmtAgo, fmtCoords, fmtDist, fmtTime, countryName } from '../lib/format.js';
import { formatDateTime } from '../shared/time.js';
import { describeSourceStatus } from '../shared/status.js';
import { RADIUS_OPTIONS } from '../lib/url-state.js';
import { severityBadge, incidentDetail, thermalDetail } from './incident-detail.js';
import { statusBadge } from './status-ui.js';
import { DISCLAIMER } from './disclaimer.js';

const MAX_ITEMS = 8;

const STATE_ICON = {
  found: '●',
  none: '○',
  'coverage-unavailable': '—',
  'source-unavailable': '!',
  'not-connected': '—',
};

function relationText(item) {
  const p = item.feature.properties;
  switch (item.relation) {
    case 'inside-area':
      return 'Selected location is inside the area published by the source';
    case 'near-area':
      return `Affected-area boundary about ${fmtDist(item.edgeKm)} away (approximate)`;
    case 'representative':
      return `Representative location ${fmtDist(item.km)} ${item.direction} — affected area may be broader`;
    case 'country':
      return `Country-level: source lists ${(p.countryCodes || []).map(countryName).join(', ')} as affected`;
    default:
      return item.km < 1 ? 'At the selected location' : `${fmtDist(item.km)} ${item.direction}`;
  }
}

function itemHtml(item, i, catIndex, now) {
  const p = item.feature.properties;
  const t = p.eventStartUtc || p.sourceUpdatedUtc;
  return html`
    <li class="event-item">
      <button type="button" class="event-toggle" aria-expanded="false" data-cat="${catIndex}" data-item="${i}">
        ${severityBadge(p)}
        <span class="event-title">${p.title}</span>
        <span class="event-meta">
          ${relationText(item)}${t ? html` · <time datetime="${t}">${fmtAgo(t, now)}</time>` : ''}
        </span>
      </button>
      <div class="event-detail" hidden></div>
    </li>`;
}

function thermalHtml(t, catIndex, now) {
  if (!t?.count) return '';
  return html`
    <p class="cat-extra">
      ${t.highCount} high-confidence · latest detection ${t.latestMs ? html`<time datetime="${new Date(t.latestMs).toISOString()}">${fmtAgo(t.latestMs, now)}</time>` : 'unknown'}
      · nearest ${fmtDist(t.nearest[0]?.km)} ${t.nearest[0]?.direction || ''}
    </p>
    <ul class="event-list">
      ${t.nearest.map(
        (d, i) => html`
          <li class="event-item">
            <button type="button" class="event-toggle" aria-expanded="false" data-cat="${catIndex}" data-thermal="${i}">
              <span class="sev-badge">${d.confidenceLabel} confidence</span>
              <span class="event-title">Satellite thermal detection · ${d.sensor || 'sensor n/a'}</span>
              <span class="event-meta">${fmtDist(d.km)} ${d.direction} · ${fmtAgo(d.timeMs, now)}</span>
            </button>
            <div class="event-detail" hidden></div>
          </li>`,
      )}
    </ul>
    <p class="caveat">Thermal detections can include wildfires, agricultural burning, industrial heat sources or other thermal anomalies.</p>`;
}

function categoryHtml(cat, catIndex, now) {
  const shown = cat.items.slice(0, MAX_ITEMS);
  return html`
    <li class="cat-row state-${cat.state}">
      <div class="cat-head">
        <span class="cat-icon" aria-hidden="true">${STATE_ICON[cat.state] || '○'}</span>
        <div class="cat-text">
          <h4 class="cat-label">${cat.label}</h4>
          <p class="cat-headline">${cat.headline}</p>
          ${cat.note ? html`<p class="muted small">${cat.note}</p>` : ''}
          ${cat.freshness ? html`<p class="cat-fresh">${cat.freshness}</p>` : ''}
        </div>
        <span class="cat-source">${cat.sourceName}${cat.state !== 'not-connected' ? html` ${statusBadge(cat.status)}` : ''}</span>
      </div>
      ${shown.length ? html`<ul class="event-list">${shown.map((it, i) => itemHtml(it, i, catIndex, now))}</ul>` : ''}
      ${cat.items.length > MAX_ITEMS ? html`<p class="muted small">…and ${cat.items.length - MAX_ITEMS} more within the radius (see map or list view).</p>` : ''}
      ${cat.category === 'thermal' ? thermalHtml(cat.thermal, catIndex, now) : ''}
    </li>`;
}

function sourcesTable(sources, now) {
  return html`
    <div class="table-wrap">
      <table class="sources-table">
        <caption class="visually-hidden">Data sources used for this card</caption>
        <thead><tr><th scope="col">Source</th><th scope="col">Status</th><th scope="col">Last fetched by this project</th><th scope="col">Source data time</th></tr></thead>
        <tbody>
          ${sources
            .filter((s) => s.implemented !== false)
            .map((s) => {
              const d = describeSourceStatus(s, now);
              return html`<tr>
                <th scope="row">${s.shortName || s.name}<span class="muted small block">${s.scheduleDescription}</span></th>
                <td>${statusBadge(d.status)}</td>
                <td>${s.lastSuccessfulFetchUtc ? html`${fmtTime(s.lastSuccessfulFetchUtc)}<span class="muted small block">${fmtAgo(s.lastSuccessfulFetchUtc, now)}</span>` : 'never'}</td>
                <td>${s.sourceLatestDataTimeUtc ? fmtTime(s.sourceLatestDataTimeUtc) : 'not supplied'}</td>
              </tr>`;
            })}
        </tbody>
      </table>
    </div>`;
}

/**
 * Render the card. `ctx` = { report, selection, manifest, filtersNote, now,
 * onRadius, onClose, onShare, onZoom, origin, fetchedFor }.
 */
export function renderLocationCard(container, ctx) {
  const { report, selection, manifest, now } = ctx;
  const place = selection.name || 'Selected point';
  const country = selection.countryCode ? countryName(selection.countryCode) : selection.countryHint || null;
  setHtml(
    container,
    html`
      <div class="card-head">
        <div>
          <p class="kicker">Location status</p>
          <h2 id="loc-title" tabindex="-1">${place}</h2>
          <p class="loc-sub">
            ${country ? html`<span>${country}</span> · ` : ''}<span>${fmtCoords(selection.lon, selection.lat)}</span>
            ${selection.nearText ? html`<span class="block muted small">${selection.nearText}</span>` : ''}
          </p>
        </div>
        <div class="card-actions">
          <button type="button" class="icon-btn" data-action="zoom" aria-label="Zoom map to this location" title="Zoom to location">⌖</button>
          <button type="button" class="icon-btn" data-action="share" aria-label="Share link to this location" title="Share">⤴</button>
          <button type="button" class="icon-btn" data-action="close" aria-label="Close location status" title="Close">✕</button>
        </div>
      </div>
      <div class="card-controls">
        <label for="radius-select">Search radius</label>
        <select id="radius-select">
          ${RADIUS_OPTIONS.map((r) => html`<option value="${r}" ${r === selection.radiusKm ? raw('selected') : ''}>${fmtDist(r)}</option>`)}
        </select>
        <span class="muted small">Time window: ${ctx.windowLabel}</span>
      </div>
      <p class="checked-at small">
        Checked against locally published data at
        <time datetime="${new Date(now).toISOString()}">${formatDateTime(now)}</time> /
        ${formatDateTime(now, { utc: true })}.
        Last published update: ${manifest?.generatedAtUtc ? fmtTime(manifest.generatedAtUtc) : 'unknown'}.
      </p>
      <div class="summary-box" role="status" aria-live="polite">
        ${report.summaryLines.map((l) => html`<p>${l}</p>`)}
      </div>
      ${ctx.filtersNote ? html`<p class="filters-note small">Active filters: ${ctx.filtersNote}</p>` : ''}
      <h3 class="section-title">By category</h3>
      <ul class="cat-list">${report.categories.map((c, i) => categoryHtml(c, i, now))}</ul>
      <p class="coverage-note">${report.coverageNote}</p>
      <details class="card-sources">
        <summary>Data sources, status and refresh times</summary>
        ${sourcesTable(manifest?.sources || [], now)}
        <p class="small">${manifest?.refreshNote || ''} Data may be delayed.</p>
        <p><a href="./sources.html">All sources and limitations</a> · <a href="./methodology.html">How matching works</a></p>
      </details>
      <p class="disclaimer small">${DISCLAIMER}</p>
    `,
  );

  container.querySelector('#radius-select').addEventListener('change', (e) => ctx.onRadius(Number(e.target.value)));
  container.querySelector('[data-action="close"]').addEventListener('click', ctx.onClose);
  container.querySelector('[data-action="share"]').addEventListener('click', ctx.onShare);
  container.querySelector('[data-action="zoom"]').addEventListener('click', ctx.onZoom);

  // Expand / collapse event details in place.
  container.querySelectorAll('.event-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const detail = btn.nextElementSibling;
      const open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      detail.hidden = open;
      if (!open && !detail.firstChild) {
        const cat = report.categories[Number(btn.dataset.cat)];
        const origin = [selection.lon, selection.lat];
        if (btn.dataset.thermal != null) {
          const fetched = cat.meta?.lastSuccessfulFetchUtc;
          detail.append(thermalDetail(cat.thermal.nearest[Number(btn.dataset.thermal)], { now, origin, fetchedUtc: fetched }));
        } else {
          const item = cat.items[Number(btn.dataset.item)];
          detail.append(incidentDetail(item.feature, { now, origin }));
          ctx.onItemFocus?.(item.feature);
        }
      }
    });
  });
}
