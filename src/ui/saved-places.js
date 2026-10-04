// "Saved places" list at the top of the layers panel.
import { html, raw, setHtml } from '../lib/dom.js';
import { countryName, fmtAgo } from '../lib/format.js';
import { listSaved } from '../lib/saved-places.js';
import { CLOSE_ICON } from './close-button.js';

export function renderSavedPlaces(el, { onOpen, onRemove }) {
  const places = listSaved();
  el.hidden = false;
  if (!places.length) {
    setHtml(
      el,
      html`<h2 class="panel-heading">Saved places</h2>
        <p class="muted small">None yet. Open a place and tap <strong>☆ Save for offline</strong> on its card to keep its map, latest data and emergency numbers on this device.</p>`,
    );
    return;
  }
  setHtml(
    el,
    html`
      <h2 class="panel-heading">Saved places</h2>
      <p class="muted small">Available offline on this device: map area, latest data seen, and emergency numbers.</p>
      <ul class="saved-list">
        ${places.map(
          (p, i) => html`<li>
            <button type="button" class="saved-open" data-i="${i}">
              <span class="saved-name">★ ${p.name}</span>
              <span class="muted small">${p.countryCode ? countryName(p.countryCode) : 'No country'} · saved ${fmtAgo(p.savedAt)}</span>
            </button>
            <button type="button" class="close-btn saved-remove" data-i="${i}" aria-label="Remove ${p.name} from saved places" title="Remove">${raw(CLOSE_ICON)}</button>
          </li>`,
        )}
      </ul>`,
  );
  el.querySelectorAll('.saved-open').forEach((b) => b.addEventListener('click', () => onOpen(places[Number(b.dataset.i)])));
  el.querySelectorAll('.saved-remove').forEach((b) => b.addEventListener('click', () => onRemove(places[Number(b.dataset.i)])));
}
