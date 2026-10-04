// Bottom "data freshness" strip: last published update + per-source status chips.
import { html, setHtml } from '../lib/dom.js';
import { describeSourceStatus, isPublishOlderThanExpected } from '../shared/status.js';
import { fmtAgo, fmtTime } from '../lib/format.js';
import { statusBadge } from './status-ui.js';

export function renderStatusStrip(el, { manifest, publish, now = Date.now(), error }) {
  if (error || !manifest) {
    setHtml(
      el,
      html`<p class="strip-line"><strong>Data unavailable:</strong> the published data manifest could not be loaded. ${error ? `(${error})` : ''}
      <a href="./sources.html">Sources</a></p>`,
    );
    return;
  }
  const old = isPublishOlderThanExpected(manifest, now);
  const chips = manifest.sources
    .filter((s) => s.implemented !== false && s.enabled !== false)
    .map((s) => {
      const d = describeSourceStatus(s, now);
      const when = s.lastSuccessfulFetchUtc ? fmtAgo(s.lastSuccessfulFetchUtc, now) : 'never';
      return html`<a class="chip status-${d.status}" href="./sources.html#${s.sourceKey}" title="${s.shortName}: last fetched by this project ${when}">
        ${statusBadge(d.status)}<span class="chip-name">${s.shortName.replace(/ \(US only\)| thermal detections| major disasters/g, '')}</span><span class="chip-age">${when}</span></a>`;
    });
  setHtml(
    el,
    html`
      <div class="strip-line">
        <span class="strip-published ${old ? 'is-old' : ''}">
          Last published update: <time datetime="${manifest.generatedAtUtc}">${fmtTime(manifest.generatedAtUtc)}</time>
          (${fmtAgo(manifest.generatedAtUtc, now)})${old ? ' — older than expected; scheduled refreshes may be delayed' : ''}.
          ${publish?.publishedAtUtc ? html`<span class="muted">Site built ${fmtAgo(publish.publishedAtUtc, now)}.</span>` : ''}
          Data may be delayed.
        </span>
        <span class="chips">${chips}</span>
        <span class="strip-links"><a href="./sources.html">Sources &amp; limitations</a> · <a href="./about.html#disclaimer">Not an emergency warning system</a></span>
      </div>`,
  );
}
