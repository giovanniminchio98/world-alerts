// Text list of mapped incidents — an accessible alternative to the visual map
// and the fallback view when the map cannot load.
import { html, setHtml } from '../lib/dom.js';
import { fmtAgo } from '../lib/format.js';
import { parseUtc } from '../shared/time.js';
import { isHighSeverity } from '../lib/filters.js';
import { severityBadge, categoryKicker } from './incident-detail.js';

const LIMIT = 150;

/** `features` = filtered normalised features from all visible point/area layers. */
export function renderIncidentList(el, { features, hasThermal, now = Date.now(), onSelect, hiddenCategories = [] }) {
  const sorted = features
    .slice()
    .sort((a, b) => Number(isHighSeverity(b.properties)) - Number(isHighSeverity(a.properties)) || (parseUtc(b.properties.eventStartUtc) ?? 0) - (parseUtc(a.properties.eventStartUtc) ?? 0));
  const shown = sorted.slice(0, LIMIT);
  setHtml(
    el,
    html`
      <p class="muted small">${sorted.length} mapped incident${sorted.length === 1 ? '' : 's'} match the current filters${sorted.length > LIMIT ? `; showing ${LIMIT} (high-severity first, then newest)` : ''}.
      ${hasThermal ? 'Satellite thermal detections are summarised on the map and in location cards, not listed here.' : ''}
      ${hiddenCategories.length ? `Hidden layers: ${hiddenCategories.join(', ')}.` : ''}</p>
      <ol class="incident-list">
        ${shown.map(
          (f, i) => html`<li>
            <button type="button" class="list-item" data-i="${i}">
              ${severityBadge(f.properties)}
              <span class="event-title">${f.properties.title}</span>
              <span class="event-meta">${categoryKicker(f.properties)}${f.properties.eventStartUtc ? ` · ${fmtAgo(f.properties.eventStartUtc, now)}` : ''}</span>
            </button>
          </li>`,
        )}
      </ol>
      ${shown.length === 0 ? html`<p>No matching incidents were detected by the connected sources for the selected filters and time window.</p>` : ''}`,
  );
  el.querySelectorAll('.list-item').forEach((b) => b.addEventListener('click', () => onSelect(shown[Number(b.dataset.i)])));
}
