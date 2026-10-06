// Small horizontal scales for event details: where a value sits on a familiar
// scale (earthquake magnitude, cyclone wind, burned / dry area) or which step of a
// source's own levels it has (GDACS alert level, NWS severity, FIRMS confidence).
// They only visualise values the source publishes; nothing is estimated here.
import { html } from '../lib/dom.js';
import { HINT_COLORS } from '../lib/colors.js';
import { hazardColor } from '../map/hazards.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const fmtNum = (n) => Math.round(n).toLocaleString('en');

function barRow(label, { pct, color, value, caption, minLabel, maxLabel, ticks = [] }) {
  return html`<div class="kv kv-scale">
    <dt>${label}</dt>
    <dd>
      <span class="scale-value">${value}</span>${caption ? html` <span class="muted">· ${caption}</span>` : ''}
      <span class="scale" style="--sc:${color};--sp:${Math.round(pct * 1000) / 10}%" role="img" aria-label="${label}: ${value}${caption ? `, ${caption}` : ''}">
        <span class="scale-track"><span class="scale-fill"></span>${ticks.map((t) => html`<span class="scale-tick" style="left:${t.pct * 100}%"></span>`)}</span>
        <span class="scale-ends" aria-hidden="true"><span>${minLabel}</span>${ticks.map((t) => html`<span class="scale-tick-label" style="left:${t.pct * 100}%">${t.label}</span>`)}<span>${maxLabel}</span></span>
      </span>
    </dd>
  </div>`;
}

function stepsRow(label, steps, active, caption) {
  const i = steps.findIndex((s) => s.key === active);
  if (i < 0) return '';
  return html`<div class="kv kv-scale">
    <dt>${label}</dt>
    <dd>
      <span class="scale-value">${steps[i].label}</span>${caption ? html` <span class="muted">· ${caption}</span>` : ''}
      <span class="steps" role="img" aria-label="${label}: ${steps[i].label} (${i + 1} of ${steps.length})">
        ${steps.map((s, j) => html`<span class="step ${j === i ? 'is-on' : ''} ${j < i ? 'is-below' : ''}" style="--c:${s.color}${s.dark ? ';--t:#1b1f24' : ''}" aria-hidden="true">${s.label}</span>`)}
      </span>
    </dd>
  </div>`;
}

// --- Earthquake magnitude (0–10, USGS magnitude classes) ---------------------
const MAG_CLASSES = [
  [8, 'great'],
  [7, 'major'],
  [6, 'strong'],
  [5, 'moderate'],
  [4, 'light'],
  [3, 'minor'],
  [-Infinity, 'very minor'],
];
export const magnitudeClass = (m) => MAG_CLASSES.find(([min]) => m >= min)[1];

export function magnitudeScale(mag, magType) {
  if (!Number.isFinite(mag)) return '';
  return barRow('Magnitude', {
    pct: clamp01(mag / 10),
    color: hazardColor('earthquake'),
    value: `M ${mag.toFixed(1)}${magType ? ` (${magType})` : ''}`,
    caption: `${magnitudeClass(mag)} · on a 0–10 scale`,
    minLabel: '0',
    maxLabel: '10',
  });
}

// --- Cyclone wind (km/h, 0–300, Saffir–Simpson thresholds marked) ----------------
// The value is the peak wind the source reports for the storm, not necessarily its
// current strength, so the storm is not labelled with a category here: the marks
// only show where the category thresholds sit (TS = tropical storm, 1–5).
const WIND_TICKS = [
  [63, 'TS'],
  [119, '1'],
  [154, '2'],
  [178, '3'],
  [209, '4'],
  [252, '5'],
].map(([kmh, label]) => ({ pct: kmh / 300, label }));

export function windScale(kmh, label = 'Peak wind') {
  if (!Number.isFinite(kmh) || kmh <= 0) return '';
  return barRow(label, {
    pct: clamp01(kmh / 300),
    color: hazardColor('storm'),
    value: `${fmtNum(kmh)} km/h`,
    caption: 'as reported by the source · marks: storm categories TS, 1–5',
    minLabel: '0',
    maxLabel: '',
    ticks: WIND_TICKS,
  });
}

// --- Affected area (logarithmic: each step is ×10) ---------------------------
function logPct(v, min, max) {
  return clamp01(Math.log10(v / min) / Math.log10(max / min));
}

export function burnedAreaScale(ha, label = 'Burned area') {
  if (!Number.isFinite(ha) || ha <= 0) return '';
  return barRow(label, {
    pct: logPct(ha, 10, 1_000_000),
    color: hazardColor('wildfire'),
    value: `${fmtNum(ha)} ha`,
    caption: `≈ ${fmtNum(ha / 100)} km² · log scale`,
    minLabel: '10 ha',
    maxLabel: '1M ha',
  });
}

export function droughtAreaScale(km2) {
  if (!Number.isFinite(km2) || km2 <= 0) return '';
  return barRow('Affected area', {
    pct: logPct(km2, 1_000, 10_000_000),
    color: hazardColor('drought'),
    value: `${fmtNum(km2)} km²`,
    caption: 'log scale',
    minLabel: '1k km²',
    maxLabel: '10M km²',
  });
}

/** EONET publishes size as text, e.g. "95 kts" or "5,072 acres". */
export function eonetMagnitudeScale(text) {
  const m = String(text || '').match(/^([\d,.]+)\s*(kts|knots|acres|ha)\b/i);
  if (!m) return '';
  const v = Number(m[1].replace(/,/g, ''));
  const unit = m[2].toLowerCase();
  if (unit === 'kts' || unit === 'knots') return windScale(v * 1.852, 'Wind (source)');
  return burnedAreaScale(unit === 'acres' ? v * 0.404686 : v, 'Area (source)');
}

// --- Source levels as steps --------------------------------------------------
const GDACS_STEPS = [
  { key: 'Green', label: 'Green', color: HINT_COLORS.green },
  { key: 'Orange', label: 'Orange', color: HINT_COLORS.orange },
  { key: 'Red', label: 'Red', color: HINT_COLORS.red },
];
export const gdacsLevelSteps = (level, score) =>
  stepsRow('GDACS alert level', GDACS_STEPS, level, score != null ? `score ${score} · expected humanitarian impact` : 'expected humanitarian impact');

const NWS_STEPS = [
  { key: 'Minor', label: 'Minor', color: HINT_COLORS.blue },
  { key: 'Moderate', label: 'Moderate', color: HINT_COLORS.yellow, dark: true },
  { key: 'Severe', label: 'Severe', color: HINT_COLORS.orange },
  { key: 'Extreme', label: 'Extreme', color: HINT_COLORS.red },
];
export const nwsSeveritySteps = (severity) => stepsRow('Severity (NWS)', NWS_STEPS, severity);

const CONFIDENCE_STEPS = [
  { key: 'low', label: 'Low', color: '#efc76f', dark: true },
  { key: 'nominal', label: 'Nominal', color: '#ef8a2c' },
  { key: 'high', label: 'High', color: '#d4421c' },
];
export const confidenceSteps = (label) => stepsRow('Confidence', CONFIDENCE_STEPS, label, 'how sure the satellite algorithm is');
