// Bottom "data freshness" strip: one compact line (last published update + an
// overall source summary) and a button that opens a dialog with per-source detail.
import { html, setHtml } from '../lib/dom.js';
import { describeSourceStatus, isPublishOlderThanExpected } from '../shared/status.js';
import { fmtAgo, fmtTime } from '../lib/format.js';
import { statusBadge, statusSentence } from './status-ui.js';
import { closeButtonHtml } from './close-button.js';

let dialogBound = false;

/** "4 of 5 sources updated": counts what worked; the dialog lists the rest. */
function summary(sources, now) {
  const ok = sources.filter((s) => describeSourceStatus(s, now).status === 'ok').length;
  const total = sources.length;
  return { status: ok === total ? 'ok' : 'partial', text: `${ok} of ${total} sources updated` };
}

/**
 * Regional sources (US-only NWS) are optional: while their layer is turned off they
 * are not counted in the summary, so a US-only feed never marks the whole site as
 * partly updated for someone who does not use it.
 */
const isOptionalOff = (s, layers) => s.scope === 'regional' && layers?.[s.category] === false;

function sourceRow(s, now) {
  const d = describeSourceStatus(s, now);
  return html`<li>
    <div class="status-row-head">${statusBadge(d.status)} <strong>${s.shortName}</strong></div>
    <p class="small">${statusSentence(s, now)}</p>
    ${s.sourceLatestDataTimeUtc ? html`<p class="small muted">Source data time: ${fmtTime(s.sourceLatestDataTimeUtc)}</p>` : ''}
    <p class="small muted">${s.scheduleDescription}</p>
  </li>`;
}

function dialogBody(manifest, publish, sources, optional, now) {
  return html`
    <div class="dialog-head">
      <h2 id="status-dialog-title">Data freshness</h2>
      ${closeButtonHtml('Close data freshness', 'data-close')}
    </div>
    <p class="small">
      Last published update: <strong>${fmtTime(manifest.generatedAtUtc)}</strong> (${fmtAgo(manifest.generatedAtUtc, now)}).
      ${publish?.publishedAtUtc ? html`Site built ${fmtAgo(publish.publishedAtUtc, now)}.` : ''} Data may be delayed.
    </p>
    <ul class="status-rows">${sources.map((s) => sourceRow(s, now))}</ul>
    ${optional.length
      ? html`<h3 class="status-optional-title">Optional — layer turned off, not counted above</h3>
        <ul class="status-rows is-optional">${optional.map((s) => sourceRow(s, now))}</ul>`
      : ''}
    <p class="small muted">${manifest.refreshNote}</p>
    <p class="small"><a href="./sources.html">All sources &amp; limitations</a> · <a href="./about.html#disclaimer">Not an emergency warning system</a></p>`;
}

export function renderStatusStrip(el, { manifest, publish, now = Date.now(), error, layers }) {
  if (error || !manifest) {
    setHtml(
      el,
      html`<p class="strip-line"><strong>Data unavailable:</strong> the published data manifest could not be loaded. ${error ? `(${error})` : ''}
      <a href="./sources.html">Sources</a></p>`,
    );
    return;
  }
  const all = manifest.sources.filter((s) => s.implemented !== false && s.enabled !== false);
  const sources = all.filter((s) => !isOptionalOff(s, layers));
  const optional = all.filter((s) => isOptionalOff(s, layers));
  const old = isPublishOlderThanExpected(manifest, now);
  const sum = summary(sources, now);
  setHtml(
    el,
    html`
      <div class="strip-line">
        <span class="strip-published ${old ? 'is-old' : ''}">
          Updated <time datetime="${manifest.generatedAtUtc}" title="Last published update: ${fmtTime(manifest.generatedAtUtc)}">${fmtAgo(manifest.generatedAtUtc, now)}</time>${old ? ' — older than expected' : ''}
          <span class="muted">· data may be delayed</span>
        </span>
        <button type="button" class="strip-status" data-open-status aria-haspopup="dialog">
          ${statusBadge(sum.status)}<span>${sum.text}</span><span aria-hidden="true">›</span>
        </button>
        <span class="strip-links"><a href="./sources.html">Sources</a> · <a href="./about.html#disclaimer">Not an emergency warning system</a></span>
      </div>`,
  );

  const dialog = document.getElementById('status-dialog');
  if (!dialog) return;
  // Keep the dialog content current (it is re-rendered as data ages).
  setHtml(dialog.querySelector('.dialog-body'), dialogBody(manifest, publish, sources, optional, now));
  el.querySelector('[data-open-status]').addEventListener('click', () => {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  });
  if (!dialogBound) {
    dialogBound = true;
    dialog.addEventListener('click', (e) => {
      // Close on the ✕ button or a click on the backdrop.
      if (e.target.closest('[data-close]') || e.target === dialog) dialog.close?.() ?? dialog.removeAttribute('open');
    });
  }
}
