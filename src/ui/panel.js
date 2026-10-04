// Layers & filters panel. Rendered once; controls mutate a copy of the filters
// and report it via onChange, so focus is never lost to a re-render.
import { html, raw, setHtml } from '../lib/dom.js';
import { TIME_WINDOWS } from '../shared/time.js';
import { DEPTH_RANGES } from '../lib/filters.js';
import { GDACS_TYPES, NATURAL_ICON, NATURAL_TYPES, NWS_SEVERITIES } from '../shared/severity.js';
import { HINT_COLORS, FIRE_COLORS } from '../lib/colors.js';
import { iconDataUrl } from '../map/icons.js';
import { statusBadge, statusSentence } from './status-ui.js';
import { describeSourceStatus } from '../shared/status.js';
import { getPrefs } from '../lib/prefs.js';
import { categoryIcon } from './category-style.js';

const LAYERS = [
  { category: 'earthquake', sourceKey: 'usgs-earthquakes', title: 'Earthquakes', sub: 'USGS · global' },
  { category: 'disaster', sourceKey: 'gdacs-disasters', title: 'Major disasters', sub: 'GDACS · global alerts' },
  { category: 'natural', sourceKey: 'eonet-events', title: 'Natural events', sub: 'NASA EONET · curated, global' },
  { category: 'thermal', sourceKey: 'firms-hotspots', title: 'Satellite thermal detections', sub: 'NASA FIRMS · not confirmed wildfires' },
  { category: 'weather', sourceKey: 'nws-alerts', title: 'Weather alerts', sub: 'NWS · United States only' },
];

const checked = (v) => (v ? raw('checked') : '');
const selected = (v) => (v ? raw('selected') : '');

function legendSwatch(color, label, size = 12) {
  return html`<li><span class="swatch" style="--c:${color};--s:${size}px" aria-hidden="true"></span>${label}</li>`;
}

export class Panel {
  constructor(el, { filters, sources, onChange, onPrefChange }) {
    this.el = el;
    this.filters = structuredClone(filters);
    this.sources = sources;
    this.onChange = onChange;
    this.onPrefChange = onPrefChange;
    this.sensors = [];
    this.render();
  }

  emit() {
    this.onChange(structuredClone(this.filters));
  }

  sourceMeta(key) {
    return this.sources.find((s) => s.sourceKey === key);
  }

  render() {
    const f = this.filters;
    const prefs = getPrefs();
    const now = Date.now();
    setHtml(
      this.el,
      html`
        <fieldset class="segmented" aria-describedby="window-help">
          <legend>Time window</legend>
          ${Object.entries(TIME_WINDOWS).map(
            ([k, w]) => html`<label class="seg"><input type="radio" name="window" value="${k}" ${checked(f.window === k)}><span>${w.short}</span></label>`,
          )}
          <p id="window-help" class="muted small">Applies to the map and the location card. Ongoing alerts are shown while active.</p>
        </fieldset>

        <h2 class="panel-heading">Layers</h2>
        ${LAYERS.map((l) => this.layerHtml(l, now))}

        <h2 class="panel-heading">Planned layers — no data source yet</h2>
        <p class="muted small">These are not connected by design (no source is integrated yet); it is not a data-download problem.</p>
        <ul class="future-list">
          ${this.sources
            .filter((s) => s.implemented === false)
            .map((s) => html`<li><span>${s.categoryLabel}</span> ${statusBadge('unavailable')}<span class="muted small block">${s.unavailableMessage || ''}</span></li>`)}
        </ul>

        <h2 class="panel-heading">Display</h2>
        <div class="display-grid">
          <label>Distance units
            <select data-pref="units"><option value="km" ${selected(prefs.units === 'km')}>Kilometres</option><option value="mi" ${selected(prefs.units === 'mi')}>Miles</option></select>
          </label>
          <label>Times shown in
            <select data-pref="timeMode"><option value="local" ${selected(prefs.timeMode === 'local')}>My local time</option><option value="utc" ${selected(prefs.timeMode === 'utc')}>UTC</option></select>
          </label>
          <label>Theme
            <select data-pref="theme"><option value="system" ${selected(prefs.theme === 'system')}>Match system</option><option value="light" ${selected(prefs.theme === 'light')}>Light</option><option value="dark" ${selected(prefs.theme === 'dark')}>Dark</option></select>
          </label>
        </div>
        <p class="muted small">Settings are stored only in this browser.</p>
      `,
    );
    this.bind();
  }

  layerHtml(l, now) {
    const meta = this.sourceMeta(l.sourceKey);
    const status = describeSourceStatus(meta, now).status;
    const on = this.filters.layers[l.category];
    return html`
      <section class="layer" data-category="${l.category}" data-cat="${l.category}">
        <div class="layer-head">
          <label class="switch">
            <input type="checkbox" data-layer="${l.category}" ${checked(on)} aria-describedby="status-${l.category}">
            <span class="switch-track" aria-hidden="true"></span>
            <span class="layer-title"><span class="layer-name">${categoryIcon(l.category)}${l.title}</span><span class="muted small block">${l.sub}</span></span>
          </label>
          <span class="layer-status" data-status="${l.category}">${statusBadge(status)}</span>
        </div>
        <p class="layer-fresh small" id="status-${l.category}" data-fresh="${l.category}">${meta ? statusSentence(meta, now) : 'Source not listed in manifest.'}</p>
        <details class="layer-details">
          <summary>Filters &amp; legend</summary>
          ${this.filtersHtml(l.category)}
        </details>
      </section>`;
  }

  filtersHtml(category) {
    const f = this.filters;
    if (category === 'earthquake') {
      return html`
        <label>Minimum magnitude
          <select data-filter="eq-mag">
            ${[[0, 'All recorded'], [2.5, 'M 2.5+'], [4.5, 'M 4.5+'], [6, 'M 6+']].map(([v, t]) => html`<option value="${v}" ${selected(f.earthquake.minMag === v)}>${t}</option>`)}
          </select>
        </label>
        <label>Depth
          <select data-filter="eq-depth">
            ${Object.entries(DEPTH_RANGES).map(([k, d]) => html`<option value="${k}" ${selected(f.earthquake.depth === k)}>${d.label}</option>`)}
          </select>
        </label>
        <label class="check"><input type="checkbox" data-filter="eq-sig" ${checked(f.earthquake.significantOnly)}> Significant events only (USGS significance ≥ 600)</label>
        <ul class="legend" aria-label="Earthquake legend">
          ${legendSwatch(HINT_COLORS.blue, 'Below M 3', 8)}
          ${legendSwatch(HINT_COLORS.yellow, 'M 3 – 4.9', 11)}
          ${legendSwatch(HINT_COLORS.orange, 'M 5 – 5.9', 15)}
          ${legendSwatch(HINT_COLORS.red, 'M 6 and above', 19)}
        </ul>
        <p class="muted small">Circle size grows with magnitude; magnitudes are labelled on the map. Smaller events are grouped into clusters at low zoom.</p>`;
    }
    if (category === 'disaster') {
      const levels = [['Red', 'Red alert'], ['Orange', 'Orange alert'], ['Green', 'Green alert'], ['none', 'Level not supplied']];
      return html`
        <fieldset class="checks"><legend>GDACS alert level (as published)</legend>
          ${levels.map(([v, t]) => html`<label class="check"><input type="checkbox" data-filter="gd-level" value="${v}" ${checked(f.disaster.levels.includes(v))}><span class="swatch" style="--c:${HINT_COLORS[v.toLowerCase()] || HINT_COLORS.gray};--s:10px" aria-hidden="true"></span> ${t}</label>`)}
        </fieldset>
        <fieldset class="checks"><legend>Hazard type</legend>
          ${Object.entries(GDACS_TYPES).map(([k, t]) => html`<label class="check"><input type="checkbox" data-filter="gd-type" value="${k}" ${checked(f.disaster.types.includes(k))}><img src="${iconDataUrl(k)}" alt="" width="18" height="18"> ${t}</label>`)}
        </fieldset>
        <p class="muted small">Dashed outlines show affected areas or tracks when GDACS publishes them. Faint halos mark representative locations — the affected area may be broader.</p>`;
    }
    if (category === 'natural') {
      return html`
        <fieldset class="checks"><legend>Event type</legend>
          ${Object.entries(NATURAL_TYPES).map(([k, t]) => html`<label class="check"><input type="checkbox" data-filter="eo-type" value="${k}" ${checked(f.natural.types.includes(k))}><img src="${iconDataUrl(NATURAL_ICON[k] || 'default')}" alt="" width="18" height="18"> ${t}</label>`)}
        </fieldset>
        <p class="muted small">Teal markers. EONET curates open events from other agencies and gives no severity level. Storms show their latest reported position and path; dashed outlines are affected areas when published.</p>`;
    }
    if (category === 'thermal') {
      return html`
        <label>Confidence
          <select data-filter="fi-conf">
            ${[[0, 'All detections'], [1, 'Nominal and high'], [2, 'High only']].map(([v, t]) => html`<option value="${v}" ${selected(f.thermal.minConfidence === v)}>${t}</option>`)}
          </select>
        </label>
        <fieldset class="checks" data-sensors><legend>Sensor</legend>${this.sensorsHtml()}</fieldset>
        <ul class="legend" aria-label="Thermal detection legend">
          ${legendSwatch(FIRE_COLORS.strong, 'High confidence, under 24 h old')}
          ${legendSwatch(FIRE_COLORS.medium, 'Nominal confidence or 24–48 h old')}
          ${legendSwatch(FIRE_COLORS.weak, 'Low confidence or older than 48 h')}
        </ul>
        <p class="muted small">At world and continental zoom, detections are aggregated into 1° cells (counts approximate). Zoom in to see individual detections. Detections are not necessarily wildfires.</p>`;
    }
    return html`
      <fieldset class="checks"><legend>NWS severity</legend>
        ${NWS_SEVERITIES.map((s) => html`<label class="check"><input type="checkbox" data-filter="wx-sev" value="${s}" ${checked(f.weather.severities.includes(s))}> ${s}</label>`)}
      </fieldset>
      <p class="muted small">United States and territories only. Zone-based alerts use simplified outlines.</p>`;
  }

  sensorsHtml() {
    if (!this.sensors.length) return html`<p class="muted small">Sensor list loads with the layer.</p>`;
    const sel = this.filters.thermal.sensors;
    return html`${this.sensors.map((s, i) => html`<label class="check"><input type="checkbox" data-filter="fi-sensor" value="${i}" ${checked(!sel || sel.includes(i))}> ${s}</label>`)}`;
  }

  setSensors(sensors) {
    this.sensors = sensors || [];
    const box = this.el.querySelector('[data-sensors]');
    if (box) {
      setHtml(box, html`<legend>Sensor</legend>${this.sensorsHtml()}`);
      box.querySelectorAll('[data-filter="fi-sensor"]').forEach((i) => i.addEventListener('change', () => this.readSensors()));
    }
  }

  readSensors() {
    const boxes = [...this.el.querySelectorAll('[data-filter="fi-sensor"]')];
    const sel = boxes.filter((b) => b.checked).map((b) => Number(b.value));
    this.filters.thermal.sensors = sel.length === boxes.length ? null : sel;
    this.emit();
  }

  /** Refresh status badges/sentences (e.g. once a minute, as data ages). */
  updateStatus(sources, now = Date.now()) {
    this.sources = sources;
    for (const l of LAYERS) {
      const meta = this.sourceMeta(l.sourceKey);
      const badge = this.el.querySelector(`[data-status="${l.category}"]`);
      const fresh = this.el.querySelector(`[data-fresh="${l.category}"]`);
      if (badge) setHtml(badge, statusBadge(describeSourceStatus(meta, now).status));
      if (fresh && meta) fresh.textContent = statusSentence(meta, now);
    }
  }

  setWindow(w) {
    this.filters.window = w;
    const input = this.el.querySelector(`input[name="window"][value="${w}"]`);
    if (input) input.checked = true;
  }

  bind() {
    const el = this.el;
    const f = this.filters;
    el.querySelectorAll('input[name="window"]').forEach((i) =>
      i.addEventListener('change', () => {
        f.window = i.value;
        this.emit();
      }),
    );
    el.querySelectorAll('[data-layer]').forEach((i) =>
      i.addEventListener('change', () => {
        f.layers[i.dataset.layer] = i.checked;
        this.emit();
      }),
    );
    const on = (sel, fn) => el.querySelectorAll(sel).forEach((i) => i.addEventListener('change', () => (fn(i), this.emit())));
    on('[data-filter="eq-mag"]', (i) => (f.earthquake.minMag = Number(i.value)));
    on('[data-filter="eq-depth"]', (i) => (f.earthquake.depth = i.value));
    on('[data-filter="eq-sig"]', (i) => (f.earthquake.significantOnly = i.checked));
    on('[data-filter="fi-conf"]', (i) => (f.thermal.minConfidence = Number(i.value)));
    const multi = (sel, assign) =>
      on(sel, () => assign([...el.querySelectorAll(sel)].filter((b) => b.checked).map((b) => b.value)));
    multi('[data-filter="gd-level"]', (v) => (f.disaster.levels = v));
    multi('[data-filter="gd-type"]', (v) => (f.disaster.types = v));
    multi('[data-filter="eo-type"]', (v) => (f.natural.types = v));
    multi('[data-filter="wx-sev"]', (v) => (f.weather.severities = v));
    el.querySelectorAll('[data-pref]').forEach((s) => s.addEventListener('change', () => this.onPrefChange(s.dataset.pref, s.value)));
  }
}

/** Human summary of non-default filters, shown on the location card. */
export function describeActiveFilters(f, defaults) {
  const parts = [];
  if (f.earthquake.minMag !== defaults.earthquake.minMag) parts.push(`earthquakes M ${f.earthquake.minMag}+`);
  if (f.earthquake.depth !== 'all') parts.push(`depth: ${DEPTH_RANGES[f.earthquake.depth]?.label}`);
  if (f.earthquake.significantOnly) parts.push('significant earthquakes only');
  if (f.disaster.levels.length !== defaults.disaster.levels.length) parts.push(`GDACS levels: ${f.disaster.levels.join(', ') || 'none'}`);
  if (f.disaster.types.length !== defaults.disaster.types.length) parts.push(`hazard types: ${f.disaster.types.join(', ') || 'none'}`);
  if (f.natural.types.length !== defaults.natural.types.length) parts.push(`natural event types: ${f.natural.types.length} of ${defaults.natural.types.length}`);
  if (f.thermal.minConfidence > 0) parts.push(f.thermal.minConfidence === 2 ? 'high-confidence detections only' : 'nominal/high-confidence detections');
  if (Array.isArray(f.thermal.sensors)) parts.push('some sensors hidden');
  if (f.weather.severities.length !== defaults.weather.severities.length) parts.push(`NWS severity: ${f.weather.severities.join(', ') || 'none'}`);
  return parts.join('; ');
}
