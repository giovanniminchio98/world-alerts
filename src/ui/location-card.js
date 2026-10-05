// Location Status card: what the connected sources report around a selected place.
import { html, raw, setHtml } from '../lib/dom.js';
import { fmtAgo, fmtCoords, fmtDist, fmtTime, countryName } from '../lib/format.js';
import { formatDateTime } from '../shared/time.js';
import { describeSourceStatus } from '../shared/status.js';
import { RADIUS_OPTIONS } from '../lib/url-state.js';
import { activityBadge, severityBadge, incidentDetail, thermalDetail } from './incident-detail.js';
import { statusBadge } from './status-ui.js';
import { DISCLAIMER } from './disclaimer.js';
import { categoryIcon } from './category-style.js';
import { closeButtonHtml } from './close-button.js';
import { emergencyRows, telHref } from '../lib/emergency.js';

const MAX_ITEMS = 8;


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
        ${severityBadge(p)} ${activityBadge(p)}
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
              <span class="event-title">Heat detection · ${d.sensor || 'sensor n/a'}</span>
              <span class="event-meta">${fmtDist(d.km)} ${d.direction} · ${fmtAgo(d.timeMs, now)}</span>
            </button>
            <div class="event-detail" hidden></div>
          </li>`,
      )}
    </ul>
    <p class="caveat">A satellite saw an unusually hot spot here. It may be a wildfire, but it can also be crop or waste burning, a factory, a gas flare or another hot surface — especially in and around cities.</p>`;
}

/** Events start expanded only when the source classifies one as high severity. */
const startsOpen = (cat) => cat.category !== 'thermal' && cat.items.some((i) => i.high);

function categoryHtml(cat, catIndex, now) {
  const shown = cat.items.slice(0, MAX_ITEMS);
  const count = cat.category === 'thermal' ? cat.thermal?.count || 0 : cat.items.length;
  const open = startsOpen(cat);
  const label = cat.category === 'thermal' ? 'nearest detections' : count === 1 ? 'event' : `${count} events`;
  return html`
    <li class="cat-row state-${cat.state}" data-cat="${cat.category}">
      <div class="cat-head">
        <span class="cat-icon">${categoryIcon(cat.category)}</span>
        <div class="cat-text">
          <h4 class="cat-label">${cat.label}${count ? html` <span class="cat-count">${count}</span>` : ''}</h4>
          <p class="cat-headline">${cat.headline}</p>
          ${cat.note ? html`<p class="muted small">${cat.note}</p>` : ''}
          ${cat.freshness ? html`<p class="cat-fresh">${cat.freshness}</p>` : ''}
        </div>
        <span class="cat-source">${cat.sourceName} ${statusBadge(cat.status)}</span>
      </div>
      ${count
        ? html`
          <button type="button" class="cat-expand" aria-expanded="${String(open)}" aria-controls="cat-items-${catIndex}">
            <span class="when-closed">Show ${label}</span><span class="when-open">Hide ${label}</span> <span aria-hidden="true" class="chev">▾</span>
          </button>
          <div class="cat-items" id="cat-items-${catIndex}" ${open ? '' : raw('hidden')}>
            ${shown.length ? html`<ul class="event-list">${shown.map((it, i) => itemHtml(it, i, catIndex, now))}</ul>` : ''}
            ${cat.items.length > MAX_ITEMS ? html`<p class="muted small">…and ${cat.items.length - MAX_ITEMS} more within the radius (see map or list view).</p>` : ''}
            ${cat.category === 'thermal' ? thermalHtml(cat.thermal, catIndex, now) : ''}
          </div>`
        : ''}
    </li>`;
}

/** Emergency numbers for the selected country (tap to call). */
function emergencyHtml(ctx, countryLabel) {
  const data = ctx.emergency;
  if (!data) return '';
  const entry = ctx.selection.countryCode ? data.countries?.[ctx.selection.countryCode] : null;
  const rows = emergencyRows(entry);
  return html`
    <section class="emergency" aria-labelledby="emergency-title">
      <h3 id="emergency-title" class="emergency-title"><span aria-hidden="true">☎</span> Emergency numbers${countryLabel ? html` · ${countryLabel}` : ''}</h3>
      ${rows.length
        ? html`<ul class="emergency-list">
            ${rows.map(
              (r) => html`<li><span class="em-label">${r.label}</span><a class="em-number" href="${telHref(r.number)}">${r.number}</a>${r.note ? html`<span class="em-note">${r.note}</span>` : ''}</li>`,
            )}
          </ul>`
        : html`<p class="small">No emergency number is listed for this location. Check local official sources.</p>`}
      <p class="em-tip"><strong>Tip:</strong> take a screenshot of these numbers so you have them even without internet.</p>
      <p class="em-caveat">From Wikipedia's list of emergency numbers (community-compiled, CC BY-SA). Numbers can change — confirm locally. On many mobile networks 112 also reaches emergency services.</p>
    </section>`;
}

/** Categories with no connected source are listed together in one line. */
function notConnectedHtml(cats) {
  if (!cats.length) return '';
  return html`
    <li class="cat-row state-not-connected" data-cat="other">
      <div class="cat-head">
        <span class="cat-icon">${categoryIcon('other')}</span>
        <div class="cat-text">
          <h4 class="cat-label">Not covered yet</h4>
          <p class="cat-headline">${cats.map((c) => c.label).join(' · ')}</p>
          <p class="muted small">No data source is connected for these categories yet — this is not a data error, and it does not mean there are no outages.</p>
        </div>
      </div>
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
          ${closeButtonHtml('Close location status', 'data-action="close"')}
        </div>
      </div>
      <div class="card-controls">
        <label for="radius-select">Search radius</label>
        <select id="radius-select">
          ${RADIUS_OPTIONS.map((r) => html`<option value="${r}" ${r === selection.radiusKm ? raw('selected') : ''}>${fmtDist(r)}</option>`)}
        </select>
        <span class="muted small">Time window: ${ctx.windowLabel}</span>
        <button type="button" class="btn btn-small save-offline" data-action="save" aria-pressed="${String(Boolean(ctx.saved))}">
          <span class="star" aria-hidden="true">${ctx.saved ? '★' : '☆'}</span> ${ctx.saved ? 'Saved for offline' : 'Save for offline'}
        </button>
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
      ${emergencyHtml(ctx, selection.countryCode ? country : null)}
      ${ctx.filtersNote ? html`<p class="filters-note small">Active filters: ${ctx.filtersNote}</p>` : ''}
      <h3 class="section-title">By category</h3>
      <ul class="cat-list">
        ${report.categories.map((c, i) => (c.state === 'not-connected' ? '' : categoryHtml(c, i, now)))}
        ${notConnectedHtml(report.categories.filter((c) => c.state === 'not-connected'))}
      </ul>
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
  container.querySelector('[data-action="save"]').addEventListener('click', ctx.onToggleSave);

  container.querySelectorAll('.cat-expand').forEach((btn) => {
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      document.getElementById(btn.getAttribute('aria-controls')).hidden = !open;
    });
  });

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
