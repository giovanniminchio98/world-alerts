// "Saved places" list at the top of the layers panel.
import { html, setHtml } from '../lib/dom.js';
import { countryName, fmtAgo } from '../lib/format.js';
import { listSaved } from '../lib/saved-places.js';

export function renderSavedPlaces(el, { onOpen, onRemove }) {
  const places = listSaved();
  el.hidden = places.length === 0;
  if (!places.length) return;
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
            <button type="button" class="icon-btn saved-remove" data-i="${i}" aria-label="Remove ${p.name} from saved places">✕</button>
          </li>`,
        )}
      </ul>`,
  );
  el.querySelectorAll('.saved-open').forEach((b) => b.addEventListener('click', () => onOpen(places[Number(b.dataset.i)])));
  el.querySelectorAll('.saved-remove').forEach((b) => b.addEventListener('click', () => onRemove(places[Number(b.dataset.i)])));
}
