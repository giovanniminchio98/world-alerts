// Sources & coverage page: renders every source from the published manifest.
import './page.js';
import { html, setHtml, safeUrl } from '../lib/dom.js';
import { loadManifest, loadPublishInfo } from '../lib/data.js';
import { describeSourceStatus } from '../shared/status.js';
import { formatDateTime, formatRelative, formatDuration } from '../shared/time.js';
import { statusBadge, statusSentence } from '../ui/status-ui.js';

const both = (iso) =>
  iso ? html`${formatDateTime(iso)} <span class="muted">· ${formatDateTime(iso, { utc: true })} · ${formatRelative(iso)}</span>` : html`<span class="muted">never / not available</span>`;
const kv = (k, v) => html`<div class="kv"><dt>${k}</dt><dd>${v ?? html`<span class="muted">—</span>`}</dd></div>`;
const link = (url, text) => (safeUrl(url) ? html`<a href="${url}" target="_blank" rel="noopener noreferrer">${text || url}</a>` : null);

function scopeTag(s) {
  if (s.implemented === false) return 'Planned / not connected';
  if (s.scope === 'regional') return 'Regional';
  if (s.scope === 'experimental') return 'Experimental';
  return 'Global';
}

function card(s, now) {
  const d = describeSourceStatus(s, now);
  return html`
    <article class="source-card" id="${s.sourceKey}">
      <header>
        <div>
          <h2>${s.name}</h2>
          <p class="muted small"><span class="tag">${scopeTag(s)}</span><span class="tag">${s.categoryLabel}</span><span class="tag">Geometry: ${s.geometryLevel}</span></p>
        </div>
        ${statusBadge(d.status)}
      </header>
      <p>${statusSentence(s, now)}</p>
      <dl class="kv-list">
        ${kv('What it provides', s.provides)}
        ${kv('Geographic coverage', s.coverage)}
        ${kv('Data limitations', s.coverageLimitations)}
        ${kv('Refresh schedule', s.implemented === false ? s.scheduleDescription : html`${s.scheduleDescription} <span class="muted">Treated as stale after ${formatDuration(s.staleAfterMinutes)} without a successful fetch.</span>`)}
        ${s.implemented === false ? '' : kv('Last successful fetch (this project)', both(s.lastSuccessfulFetchUtc))}
        ${s.implemented === false ? '' : kv('Last fetch attempt', html`${both(s.lastAttemptUtc)}${s.lastAttemptOk === false ? html` <strong>(failed)</strong>` : ''}`)}
        ${s.implemented === false ? '' : kv('Latest source data time', s.sourceLatestDataTimeUtc ? both(s.sourceLatestDataTimeUtc) : html`<span class="muted">not supplied by source</span>`)}
        ${s.implemented === false ? '' : kv('Records published', s.recordsPublished != null ? String(s.recordsPublished) : null)}
        ${kv('Attribution / licence', s.licenseOrAttribution)}
        ${kv('Official links', html`${link(s.homepageUrl, 'Homepage')}${s.docsUrl ? html` · ${link(s.docsUrl, 'Documentation')}` : ''}${s.sourceUrl ? html` · ${link(s.sourceUrl, 'Feed used')}` : ''}`)}
        ${s.requiresSecret ? kv('Credentials', `${s.requiresSecret}. Stored only as a GitHub Actions secret; never sent to browsers.`) : ''}
        ${s.notes ? kv('Notes', s.notes) : ''}
        ${s.error ? kv('Diagnostics (last error)', html`<p class="diag">${s.error}</p>`) : ''}
        ${s.workflowRunUrl ? kv('Workflow run', link(s.workflowRunUrl, 'GitHub Actions run that produced this status')) : ''}
      </dl>
    </article>`;
}

const root = document.getElementById('sources-root');
try {
  const [manifest, publish] = await Promise.all([loadManifest(), loadPublishInfo()]);
  const now = Date.now();
  const active = manifest.sources.filter((s) => s.implemented !== false);
  const planned = manifest.sources.filter((s) => s.implemented === false);
  setHtml(
    root,
    html`
      ${manifest.mode === 'fixture' ? html`<p class="callout"><strong>Sample data.</strong> This build uses locally generated demonstration fixtures, not real incidents.</p>` : ''}
      <h2>Publication</h2>
      <dl class="kv-list source-card">
        ${kv('Data manifest generated', both(manifest.generatedAtUtc))}
        ${kv('Site build published', publish?.publishedAtUtc ? both(publish.publishedAtUtc) : null)}
        ${kv('App version', manifest.appVersion)}
        ${kv('Build commit', manifest.buildCommitSha || publish?.commitSha)}
        ${manifest.workflowRunUrl ? kv('Data refresh run', link(manifest.workflowRunUrl, 'GitHub Actions run')) : ''}
      </dl>
      <p class="small muted">${manifest.refreshNote}</p>
      <h2>Connected sources</h2>
      ${active.map((s) => card(s, now))}
      <h2>Planned / experimental layers (not connected)</h2>
      <p>These categories are designed into the app but have no connected source. The map and location cards show them as “not connected” rather than implying there are no disruptions.</p>
      ${planned.map((s) => card(s, now))}
    `,
  );
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
} catch (e) {
  setHtml(root, html`<p class="callout">The published data manifest could not be loaded (${e.message}). Source details are unavailable right now.</p>`);
}
