// Place search combobox: instant local suggestions, explicit worldwide search.
import { html, setHtml, debounce } from '../lib/dom.js';
import { loadCities, searchCityIndex, searchNominatim } from '../lib/geocode.js';
import { fmtCoords } from '../lib/format.js';

export function initSearch({ form, input, list, status, onChoose }) {
  let options = [];
  let active = -1;
  let cities = null;
  let controller = null;

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };

  const render = (items, { worldwideFor } = {}) => {
    options = items;
    active = -1;
    const worldwide = worldwideFor
      ? html`<li role="option" id="search-opt-ww" class="search-opt ww" data-ww="1" aria-selected="false">Search worldwide for “${worldwideFor}” <span class="muted small">(press Enter · OpenStreetMap Nominatim)</span></li>`
      : '';
    setHtml(
      list,
      html`${items.map(
        (p, i) => html`<li role="option" id="search-opt-${i}" class="search-opt" data-i="${i}" aria-selected="false">
          <span class="opt-name">${p.name}</span>
          <span class="opt-meta">${[p.country, p.type && p.source === 'nominatim' ? p.type : null].filter(Boolean).join(' · ')} · ${fmtCoords(p.lon, p.lat)}</span>
          ${p.displayName ? html`<span class="opt-full muted small">${p.displayName}</span>` : ''}
        </li>`,
      )}${worldwide}`,
    );
    const any = items.length || worldwideFor;
    list.hidden = !any;
    input.setAttribute('aria-expanded', String(Boolean(any)));
  };

  const highlight = (i) => {
    const opts = [...list.querySelectorAll('[role="option"]')];
    opts.forEach((o, j) => o.setAttribute('aria-selected', String(j === i)));
    active = i;
    if (opts[i]) {
      input.setAttribute('aria-activedescendant', opts[i].id);
      opts[i].scrollIntoView({ block: 'nearest' });
    }
  };

  const choose = (place) => {
    close();
    input.value = place.name;
    status.textContent = `Selected ${place.name}${place.country ? `, ${place.country}` : ''}.`;
    onChoose(place);
  };

  const worldwide = async () => {
    const q = input.value.trim();
    if (q.length < 2) return;
    controller?.abort();
    controller = new AbortController();
    status.textContent = 'Searching worldwide…';
    try {
      const results = await searchNominatim(q, { signal: controller.signal });
      render(results);
      status.textContent = results.length ? `${results.length} results. Use the arrow keys to choose.` : `No places found for “${q}”.`;
      if (!results.length) close();
    } catch (e) {
      if (e.name === 'AbortError') return;
      status.textContent = 'Worldwide search is unavailable right now. Suggestions from the built-in city list still work.';
    }
  };

  const suggest = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) return close();
    try {
      cities = cities || (await loadCities());
    } catch {
      cities = [];
    }
    const items = searchCityIndex(cities, q);
    render(items, { worldwideFor: q });
    status.textContent = items.length ? `${items.length} suggestions available.` : '';
  }, 150);

  input.addEventListener('input', suggest);
  input.addEventListener('focus', () => loadCities().then((c) => (cities = c)).catch(() => {}), { once: true });
  input.addEventListener('keydown', (e) => {
    const count = list.querySelectorAll('[role="option"]').length;
    if (e.key === 'ArrowDown' && count) {
      e.preventDefault();
      highlight((active + 1) % count);
    } else if (e.key === 'ArrowUp' && count) {
      e.preventDefault();
      highlight((active - 1 + count) % count);
    } else if (e.key === 'Escape') {
      close();
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (active >= 0 && active < options.length) choose(options[active]);
    else worldwide();
  });
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const li = e.target.closest('[role="option"]');
    if (!li) return;
    if (li.dataset.ww) worldwide();
    else choose(options[Number(li.dataset.i)]);
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  return { close };
}
