// Main map page: loads published data, renders map + panels, handles selection.
import './styles/main.css';
import { $, debounce } from './lib/dom.js';
import { applyTheme, effectiveTheme, getPrefs, onPrefsChange, setPref } from './lib/prefs.js';
import { load, save } from './lib/storage.js';
import { loadDataFile, loadManifest, loadPublishInfo, incidentPath, sourceVersion } from './lib/data.js';
import { FiresStore } from './lib/fires.js';
import { DEFAULT_FILTERS, disasterMatches, earthquakeMatches, filterFeatures, mergeFilters, weatherMatches } from './lib/filters.js';
import { buildLocationReport } from './lib/relevance.js';
import { readUrlState, writeUrlState, buildUrl } from './lib/url-state.js';
import { countryAt } from './lib/countries.js';
import { loadCities, nearestCity } from './lib/geocode.js';
import { fmtDist, fmtTime, countryName } from './lib/format.js';
import { radiusBbox } from './shared/geo.js';
import { TIME_WINDOWS } from './shared/time.js';
import { decodeRow } from './shared/firms-codec.js';
import { Panel, describeActiveFilters } from './ui/panel.js';
import { renderStatusStrip } from './ui/status-strip.js';
import { renderLocationCard } from './ui/location-card.js';
import { renderIncidentList } from './ui/incident-list.js';
import { incidentDetail, thermalDetail } from './ui/incident-detail.js';
import { initSearch } from './ui/search.js';
import { initChrome, toast } from './ui/chrome.js';
import { earthquakesToMap, disastersToMap, weatherToMap, fireSummaryToMap, fireDetailToMap } from './map/render-data.js';

const SOURCE_FOR = { earthquake: 'usgs-earthquakes', disaster: 'gdacs-disasters', weather: 'nws-alerts' };
const MATCHERS = { earthquake: earthquakeMatches, disaster: disasterMatches, weather: weatherMatches };
const DETAIL_ZOOM = 5;
const MANIFEST_POLL_MS = 10 * 60_000;

const url = readUrlState();
const state = {
  manifest: null,
  publish: null,
  datasets: { earthquake: null, disaster: null, weather: null },
  loadErrors: {},
  byId: new Map(),
  filters: mergeFilters(load('filters', null)),
  selection: null,
  fires: null,
  firesIndex: null,
  firesSummary: null,
  fireRows: [],
  map: null,
  panel: null,
};
if (url.window) state.filters.window = url.window;

applyTheme();
initChrome();

// --- Data -------------------------------------------------------------------

const sourceMeta = (key) => state.manifest?.sources.find((s) => s.sourceKey === key);

async function loadAllData() {
  const [manifest, publish] = await Promise.all([loadManifest(), loadPublishInfo()]);
  state.manifest = manifest;
  state.publish = publish;
  $('#demo-banner').hidden = manifest.mode !== 'fixture';
  await Promise.all(
    Object.entries(SOURCE_FOR).map(async ([cat, key]) => {
      const meta = sourceMeta(key);
      if (!meta || !meta.lastSuccessfulFetchUtc || meta.implemented === false || meta.enabled === false) {
        state.datasets[cat] = null;
        return;
      }
      try {
        state.datasets[cat] = await loadDataFile(incidentPath(key), sourceVersion(meta));
        state.loadErrors[cat] = false;
      } catch (e) {
        console.warn(`Could not load ${key}:`, e);
        state.datasets[cat] = null;
        state.loadErrors[cat] = true;
      }
    }),
  );
  state.byId.clear();
  for (const fc of Object.values(state.datasets)) for (const f of fc?.features || []) state.byId.set(f.properties.id, f);
  const firesMeta = sourceMeta('firms-hotspots');
  state.fires = firesMeta?.lastSuccessfulFetchUtc ? new FiresStore(firesMeta, sourceVersion(firesMeta)) : null;
  state.firesIndex = null;
  state.firesSummary = null;
}

function filtered(cat) {
  return filterFeatures(state.datasets[cat], MATCHERS[cat], state.filters, Date.now());
}

// --- Rendering ----------------------------------------------------------------

function renderStrip() {
  renderStatusStrip($('#status-strip'), { manifest: state.manifest, publish: state.publish, now: Date.now() });
}

function renderList() {
  const cats = Object.keys(SOURCE_FOR).filter((c) => state.filters.layers[c]);
  const features = cats.flatMap((c) => filtered(c));
  const hidden = Object.keys(state.filters.layers).filter((c) => !state.filters.layers[c]);
  renderIncidentList($('#incident-list'), {
    features,
    hasThermal: Boolean(state.fires),
    hiddenCategories: hidden,
    onSelect: (f) => {
      const [lon, lat] = f.geometry.type === 'Point' ? f.geometry.coordinates : centroidOf(f.geometry);
      if (state.map) {
        state.map.flyTo(lon, lat, 6);
        state.map.popup([lon, lat], detailFor(f, [lon, lat]));
      } else {
        selectLocation({ lon, lat, name: f.properties.title, source: 'list' });
      }
      closeDrawerOnMobile();
    },
  });
}

function centroidOf(geometry) {
  const pts = [];
  const visit = (c) => (typeof c[0] === 'number' ? pts.push(c) : c.forEach(visit));
  visit(geometry.coordinates);
  const lon = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return [lon, lat];
}

function detailFor(feature, lngLat) {
  return incidentDetail(feature, {
    now: Date.now(),
    origin: state.selection ? [state.selection.lon, state.selection.lat] : null,
    onCheckLocation: (lon, lat) => {
      const [x, y] = lon == null ? lngLat : [lon, lat];
      state.map?.closePopup();
      selectLocation({ lon: x, lat: y, source: 'click' });
    },
  });
}

function pushMapData() {
  const m = state.map;
  if (!m) return;
  const eq = earthquakesToMap(filtered('earthquake'));
  m.setData('gim-eq-major', eq.major);
  m.setData('gim-eq-minor', eq.minor);
  const gd = disastersToMap(filtered('disaster'));
  m.setData('gim-gdacs-points', gd.points);
  m.setData('gim-gdacs-areas', gd.areas);
  m.setData('gim-gdacs-tracks', gd.tracks);
  m.setData('gim-nws', weatherToMap(filtered('weather')));
  for (const cat of Object.keys(state.filters.layers)) m.setVisibility(cat, state.filters.layers[cat]);
  updateFires();
}

async function ensureFiresBase() {
  if (!state.fires) return false;
  try {
    if (!state.firesIndex) {
      state.firesIndex = await state.fires.index();
      state.panel?.setSensors(state.firesIndex.sensors);
    }
    if (!state.firesSummary) state.firesSummary = await state.fires.summary();
    return true;
  } catch (e) {
    console.warn('Thermal detections unavailable:', e);
    state.loadErrors.thermal = true;
    return false;
  }
}

const updateFires = debounce(async () => {
  const m = state.map;
  if (!m || !state.filters.layers.thermal || !(await ensureFiresBase())) {
    m?.setData('gim-fires-summary', { type: 'FeatureCollection', features: [] });
    m?.setData('gim-fires-detail', { type: 'FeatureCollection', features: [] });
    return;
  }
  m.setData('gim-fires-summary', fireSummaryToMap(state.firesSummary, state.filters));
  if (m.getZoom() >= DETAIL_ZOOM - 0.5) {
    try {
      const rows = await state.fires.rowsFor(m.getBbox());
      const { fc, rows: kept } = fireDetailToMap(rows, state.filters, Date.now());
      state.fireRows = kept;
      m.setData('gim-fires-detail', fc);
    } catch (e) {
      console.warn('Could not load thermal tiles:', e);
    }
  } else {
    m.setData('gim-fires-detail', { type: 'FeatureCollection', features: [] });
  }
}, 200);

function onFeatureClick(f, lngLat) {
  const fid = f.properties.fid;
  if (typeof fid === 'string' && fid.startsWith('fire:')) {
    const row = state.fireRows[Number(fid.slice(5))];
    if (!row) return;
    const d = decodeRow(row, state.firesIndex?.sensors || []);
    state.map.popup(lngLat, thermalDetail(d, {
      now: Date.now(),
      origin: state.selection ? [state.selection.lon, state.selection.lat] : null,
      fetchedUtc: sourceMeta('firms-hotspots')?.lastSuccessfulFetchUtc,
      onCheckLocation: (lon, lat) => {
        state.map.closePopup();
        selectLocation({ lon, lat, source: 'click' });
      },
    }));
    return;
  }
  const feature = state.byId.get(fid);
  if (feature) state.map.popup(lngLat, detailFor(feature, [lngLat.lng, lngLat.lat]));
}

// --- Location selection -----------------------------------------------------

async function thermalNear(sel) {
  if (!state.fires || !(await ensureFiresBase())) return null;
  try {
    const rows = await state.fires.rowsFor(radiusBbox(sel.lon, sel.lat, sel.radiusKm), 60);
    return { rows, sensors: state.firesIndex.sensors };
  } catch {
    state.loadErrors.thermal = true;
    return null;
  }
}

async function describePlace(sel) {
  if (!sel.countryCode) {
    const c = await countryAt(sel.lon, sel.lat);
    if (c?.iso2) sel.countryCode = c.iso2;
    else if (c?.name) sel.countryHint = c.name;
  }
  if (!sel.name || sel.source === 'click' || sel.source === 'geolocation' || sel.source === 'centre') {
    try {
      const near = nearestCity(await loadCities(), sel.lon, sel.lat);
      if (near) {
        sel.nearText = near.km < 3 ? `In or near ${near.name}` : `About ${fmtDist(near.km)} ${near.direction} of ${near.name}, ${countryName(near.countryCode)}`;
        if (!sel.name) sel.name = sel.source === 'geolocation' ? 'Your location' : `Near ${near.name}`;
      }
    } catch {
      /* city list unavailable */
    }
  }
  if (!sel.name) sel.name = sel.source === 'geolocation' ? 'Your location' : 'Selected point';
  if (!sel.countryCode && !sel.countryHint) sel.countryHint = 'No country found (possibly at sea)';
}

let selectToken = 0;
async function selectLocation(input, { fly = true } = {}) {
  const token = ++selectToken;
  const sel = {
    lon: Number(input.lon),
    lat: Number(input.lat),
    name: input.name || null,
    countryCode: input.countryCode || null,
    radiusKm: input.radiusKm || state.selection?.radiusKm || 100,
    source: input.source,
  };
  const panel = $('#location-panel');
  // Remember the view so closing the card returns the map to where it was.
  if (!state.selection && state.map && !state.viewBeforeSelection) state.viewBeforeSelection = state.map.getView();
  panel.hidden = false;
  document.body.classList.add('has-selection');
  panel.querySelector('.location-body').innerHTML = '<p class="loading">Checking connected sources…</p>';
  state.map?.setSelection(sel);
  // The card changes the map's size (side column / bottom sheet): resize first
  // so the camera move is computed for the final layout and nothing drifts.
  state.map?.resize();
  syncMapPadding();
  if (fly && state.map) state.map.fitRadius(sel.lon, sel.lat, sel.radiusKm);
  else if (state.map && isMobile()) state.map.centerOn(sel.lon, sel.lat);
  await describePlace(sel);
  const thermal = await thermalNear(sel);
  if (token !== selectToken) return;
  state.selection = sel;
  renderCard(thermal);
  writeUrl();
  const title = $('#loc-title');
  if (input.focusCard !== false) title?.focus({ preventScroll: true });
}

async function refreshCard() {
  if (!state.selection) return;
  const thermal = await thermalNear(state.selection);
  renderCard(thermal);
}

function renderCard(thermal) {
  const sel = state.selection;
  const now = Date.now();
  const report = buildLocationReport({
    selection: sel,
    datasets: state.datasets,
    loadErrors: state.loadErrors,
    thermal,
    sources: state.manifest?.sources || [],
    filters: state.filters,
    now,
    formatTime: (ms) => fmtTime(ms),
  });
  renderLocationCard($('#location-panel .location-body'), {
    report,
    selection: sel,
    manifest: state.manifest,
    now,
    windowLabel: TIME_WINDOWS[state.filters.window]?.label || state.filters.window,
    filtersNote: describeActiveFilters(state.filters, DEFAULT_FILTERS),
    onRadius: (r) => {
      state.selection.radiusKm = r;
      state.map?.setSelection(state.selection);
      state.map?.fitRadius(sel.lon, sel.lat, r);
      refreshCard();
      writeUrl();
    },
    onClose: clearSelection,
    onShare: share,
    onZoom: () => state.map?.fitRadius(sel.lon, sel.lat, sel.radiusKm),
  });
}

function clearSelection() {
  selectToken++;
  state.selection = null;
  $('#location-panel').hidden = true;
  document.body.classList.remove('has-selection', 'sheet-expanded');
  state.map?.setSelection(null);
  state.map?.resize();
  syncMapPadding();
  if (state.viewBeforeSelection) state.map?.setView(state.viewBeforeSelection);
  state.viewBeforeSelection = null;
  writeUrl();
  // On touch devices, focusing the search box would pop up the keyboard and
  // shift / zoom the page, so focus the map instead.
  if (matchMedia('(pointer: coarse)').matches) document.querySelector('.maplibregl-canvas')?.focus({ preventScroll: true });
  else $('#search-input').focus({ preventScroll: true });
}

const isMobile = () => matchMedia('(max-width: 860px)').matches;

/** On mobile the card is a bottom sheet over the map: pad the map so its centre stays visible. */
function syncMapPadding() {
  if (!state.map?.map) return;
  const panel = $('#location-panel');
  if (!isMobile() || panel.hidden) return state.map.setBottomPadding(0);
  const mapRect = $('#map').getBoundingClientRect();
  const sheetRect = panel.getBoundingClientRect();
  state.map.setBottomPadding(Math.min(mapRect.height * 0.8, Math.max(0, mapRect.bottom - sheetRect.top)));
}

function writeUrl() {
  writeUrlState({ selection: state.selection, window: state.filters.window, view: state.map?.getView() });
}

async function share() {
  const link = buildUrl({ selection: state.selection, window: state.filters.window, view: state.map?.getView() });
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ title: 'Global Incident Map', text: state.selection ? `Incident status around ${state.selection.name}` : 'Global Incident Map', url: link });
      return;
    }
    await navigator.clipboard.writeText(link);
    toast('Link copied to clipboard.');
  } catch (e) {
    if (e?.name === 'AbortError') return;
    window.prompt('Copy this link:', link);
  }
}

function locate() {
  if (!('geolocation' in navigator)) {
    toast('Location is not available in this browser. Search for a place instead.');
    return;
  }
  toast('Requesting your location… (it stays in this browser and is not sent to this project)');
  navigator.geolocation.getCurrentPosition(
    (pos) => selectLocation({ lon: pos.coords.longitude, lat: pos.coords.latitude, source: 'geolocation' }),
    (err) => {
      const msg = err.code === err.PERMISSION_DENIED ? 'Location permission was declined.' : 'Your location could not be determined.';
      toast(`${msg} You can search for a place or click the map instead.`);
    },
    { enableHighAccuracy: false, timeout: 12_000, maximumAge: 300_000 },
  );
}

// --- Map --------------------------------------------------------------------

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function showMapFallback(reason) {
  console.warn('Map unavailable:', reason);
  $('#map-fallback').hidden = false;
  $('#map').hidden = true;
  showTab('list');
}

async function initMap() {
  if (!webglAvailable()) return showMapFallback('WebGL not available');
  try {
    const [maplibreModule, { MapController }, { default: workerUrl }] = await Promise.all([
      import('maplibre-gl'),
      import('./map/controller.js'),
      // MapLibre v6 loads its worker from a separate module; let Vite bundle it.
      import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'),
      import('maplibre-gl/dist/maplibre-gl.css'),
    ]);
    const maplibregl = maplibreModule.default ?? maplibreModule;
    maplibregl.setWorkerUrl(workerUrl);
    const prefs = getPrefs();
    state.map = new MapController(maplibregl, $('#map'), {
      theme: effectiveTheme(),
      units: prefs.units,
      view: url.view,
      onReady: () => pushMapData(),
      onSelect: (lon, lat) => selectLocation({ lon, lat, source: 'click' }, { fly: false }),
      onFeatureClick,
      onMove: () => {
        updateFires();
        writeUrl();
      },
      onBasemapFallback: () => {
        $('#basemap-note').hidden = false;
      },
    }).init();
  } catch (e) {
    showMapFallback(e);
  }
}

// --- Panels / chrome ----------------------------------------------------------

function showTab(name) {
  for (const t of document.querySelectorAll('[role="tab"]')) {
    const on = t.dataset.tab === name;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $(`#${t.getAttribute('aria-controls')}`).hidden = !on;
  }
  if (name === 'list') renderList();
}

function closeDrawerOnMobile() {
  if (isMobile()) {
    document.body.classList.remove('panel-open');
    $('#btn-layers').setAttribute('aria-expanded', 'false');
  }
}

function onFiltersChange(filters) {
  const windowChanged = filters.window !== state.filters.window;
  state.filters = filters;
  save('filters', { ...filters, window: filters.window });
  pushMapData();
  if (!$('#tab-list').hidden) renderList();
  if (state.selection) refreshCard();
  if (windowChanged) writeUrl();
}

function bindChrome() {
  $('#btn-locate').addEventListener('click', locate);
  $('#btn-share').addEventListener('click', share);
  $('#btn-reset').addEventListener('click', () => state.map?.resetWorld());
  $('#btn-centre').addEventListener('click', () => {
    if (!state.map) return;
    const { center } = state.map.getView();
    selectLocation({ lon: center[0], lat: center[1], source: 'centre' }, { fly: false });
  });
  const layersBtn = $('#btn-layers');
  layersBtn.addEventListener('click', () => {
    const open = !document.body.classList.contains('panel-open');
    document.body.classList.toggle('panel-open', open);
    layersBtn.setAttribute('aria-expanded', String(open));
    if (open) $('#panel').focus();
    setTimeout(() => state.map?.resize(), 250);
  });
  $('#panel-close').addEventListener('click', () => {
    document.body.classList.remove('panel-open');
    layersBtn.setAttribute('aria-expanded', 'false');
    layersBtn.focus();
  });
  for (const t of document.querySelectorAll('[role="tab"]')) {
    t.addEventListener('click', () => showTab(t.dataset.tab));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const tabs = [...document.querySelectorAll('[role="tab"]')];
      const next = tabs[(tabs.indexOf(t) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      showTab(next.dataset.tab);
      next.focus();
    });
  }
  $('#sheet-toggle').addEventListener('click', () => {
    const expanded = document.body.classList.toggle('sheet-expanded');
    $('#sheet-toggle').setAttribute('aria-expanded', String(expanded));
    setTimeout(syncMapPadding, 250);
  });
  window.addEventListener('resize', debounce(syncMapPadding, 200));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('panel-open')) $('#panel-close').click();
  });
  initSearch({
    form: $('#search-form'),
    input: $('#search-input'),
    list: $('#search-results'),
    status: $('#search-status'),
    onChoose: (p) => selectLocation({ lon: p.lon, lat: p.lat, name: p.name, countryCode: p.countryCode, source: 'search' }),
  });
  onPrefsChange((prefs, key) => {
    if (key === 'theme') {
      applyTheme();
      state.map?.setTheme(effectiveTheme());
    }
    renderStrip();
    state.panel?.updateStatus(state.manifest?.sources || []);
    if (!$('#tab-list').hidden) renderList();
    if (state.selection) refreshCard();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (getPrefs().theme === 'system') state.map?.setTheme(effectiveTheme());
  });
}

async function pollManifest() {
  try {
    const m = await loadManifest();
    if (m.generatedAtUtc !== state.manifest?.generatedAtUtc) {
      await loadAllData();
      state.panel?.updateStatus(state.manifest.sources);
      pushMapData();
      if (!$('#tab-list').hidden) renderList();
      if (state.selection) refreshCard();
      toast('Newly published data was loaded.');
    }
  } catch {
    /* keep showing current data; the strip will show it ageing */
  }
  renderStrip();
}

// --- Boot -------------------------------------------------------------------

bindChrome();
const mapReady = initMap();
try {
  await loadAllData();
} catch (e) {
  console.error(e);
  state.manifest = { sources: [], generatedAtUtc: null };
  renderStatusStrip($('#status-strip'), { manifest: null, error: e.message });
}
if (state.manifest?.generatedAtUtc) renderStrip();
state.panel = new Panel($('#tab-layers'), {
  filters: state.filters,
  sources: state.manifest.sources,
  onChange: onFiltersChange,
  onPrefChange: (k, v) => setPref(k, v),
});
if (state.firesIndex) state.panel.setSensors(state.firesIndex.sensors);
if (state.filters.layers.thermal) ensureFiresBase();
await mapReady;
if (state.map?.map?.isStyleLoaded()) pushMapData();
if (url.selection) selectLocation({ ...url.selection, source: 'url', focusCard: false }, { fly: !url.view });

setInterval(() => {
  renderStrip();
  state.panel?.updateStatus(state.manifest?.sources || []);
}, 60_000);
setInterval(pollManifest, MANIFEST_POLL_MS);
