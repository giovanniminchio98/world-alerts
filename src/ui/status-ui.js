// Shared wording + badges for source status (ok / stale / failed / unavailable).
import { html } from '../lib/dom.js';
import { describeSourceStatus } from '../shared/status.js';
import { fmtAgo, fmtTime } from '../lib/format.js';

const LABELS = { ok: 'Updated', stale: 'Stale', failed: 'Refresh failed', unavailable: 'Not connected', partial: 'Partly updated' };
const ICONS = { ok: '✓', stale: '◷', failed: '!', unavailable: '–', partial: '◐' };

export function statusBadge(status) {
  return html`<span class="status-badge status-${status}"><span aria-hidden="true">${ICONS[status] || '?'}</span> ${LABELS[status] || status}</span>`;
}

/** One-line, non-alarming status description for a source. */
export function statusSentence(meta, now = Date.now()) {
  const d = describeSourceStatus(meta, now);
  const last = meta?.lastSuccessfulFetchUtc;
  switch (d.status) {
    case 'ok':
      return `Updated ${fmtAgo(last, now)} (last fetched by this project ${fmtTime(last)}).${d.lastAttemptFailed ? ' The most recent refresh attempt failed; showing the previous successful fetch.' : ''}`;
    case 'stale':
      return `Data may be stale — last successful project update ${fmtTime(last)} (${fmtAgo(last, now)}).`;
    case 'failed':
      return d.hasData
        ? `This source could not be refreshed. Showing last valid data from ${fmtTime(last)} (${fmtAgo(last, now)}).`
        : 'This source could not be refreshed. No data currently available.';
    default:
      return meta?.unavailableMessage || 'Coverage unavailable — no source connected.';
  }
}
