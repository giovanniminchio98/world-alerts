// MapLibre map wrapper: basemap (with offline fallback), data sources/layers,
// clustering, selection overlay and interaction wiring.

import { registerIcons } from './icons.js';
import { HINT_COLORS, FIRE_COLORS } from '../lib/colors.js';
import { loadCountries } from '../lib/countries.js';
import { EARTH_RADIUS_KM } from '../shared/geo.js';
import { prefersReducedMotion } from '../lib/dom.js';
import { closeButtonElement } from '../ui/close-button.js';

/**
 * Basemaps from OpenFreeMap (https://openfreemap.org): OpenStreetMap-based
 * vector tiles, free to use without keys or registration. Attribution is
 * provided by the style and shown in the attribution control.
 */
export const BASEMAPS = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};
const FONT = ['Noto Sans Regular'];
export const NATURAL_COLOR = '#0f8a7e';
const STYLE_TIMEOUT_MS = 10_000;

export const WORLD_VIEW = { center: [10, 20], zoom: 1.4 };

const EMPTY = { type: 'FeatureCollection', features: [] };

/** Layer ids grouped by data category, for visibility toggles. */
const CATEGORY_LAYERS = {
  weather: ['gim-nws-fill', 'gim-nws-pattern', 'gim-nws-line'],
  disaster: ['gim-gdacs-area-fill', 'gim-gdacs-area-pattern', 'gim-gdacs-area-line', 'gim-gdacs-track', 'gim-gdacs-track-arrows', 'gim-gdacs-glow', 'gim-gdacs-halo', 'gim-gdacs-icon'],
  natural: ['gim-eonet-area-fill', 'gim-eonet-area-pattern', 'gim-eonet-area-line', 'gim-eonet-track', 'gim-eonet-track-arrows', 'gim-eonet-glow', 'gim-eonet-halo', 'gim-eonet-icon'],
  thermal: ['gim-fires-summary', 'gim-fires-summary-count', 'gim-fires-detail'],
  earthquake: ['gim-eq-cluster', 'gim-eq-cluster-count', 'gim-eq-minor', 'gim-eq-major', 'gim-eq-major-label', 'gim-eq-minor-label'],
};

/** Clickable layers in priority order (first match wins). */
const INTERACTIVE = ['gim-gdacs-icon', 'gim-eonet-icon', 'gim-eq-major', 'gim-eq-minor', 'gim-eq-cluster', 'gim-fires-detail', 'gim-fires-summary'];

function circlePolygon(lon, lat, radiusKm, steps = 96) {
  const coords = [];
  const δ = radiusKm / EARTH_RADIUS_KM;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  for (let i = 0; i <= steps; i++) {
    const θ = (i / steps) * 2 * Math.PI;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
    coords.push([(λ2 * 180) / Math.PI, (φ2 * 180) / Math.PI]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } };
}

export class MapController {
  constructor(maplibregl, container, opts) {
    this.ml = maplibregl;
    this.container = container;
    this.opts = opts;
    this.data = {};
    this.visibility = { earthquake: true, disaster: true, natural: true, thermal: true, weather: true };
    this.fallback = false;
    this.hasGlyphs = true;
    this.theme = opts.theme;
    this.selection = null;
    this.marker = null;
  }

  init() {
    const view = this.opts.view || WORLD_VIEW;
    this.map = new this.ml.Map({
      container: this.container,
      style: BASEMAPS[this.theme] || BASEMAPS.light,
      center: view.center,
      zoom: view.zoom,
      minZoom: 0.8,
      maxZoom: 14,
      attributionControl: { compact: true, customAttribution: 'Incident data: USGS · GDACS · NASA FIRMS · NOAA/NWS' },
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      fadeDuration: prefersReducedMotion() ? 0 : 300,
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.addControl(new this.ml.NavigationControl({ showCompass: false }), 'bottom-right');
    this.map.addControl(new this.ml.ScaleControl({ unit: this.opts.units === 'mi' ? 'imperial' : 'metric' }), 'bottom-left');

    this.styleLoaded = false;
    this.styleTimer = setTimeout(() => {
      if (!this.styleLoaded) this.useFallbackStyle('basemap timed out');
    }, STYLE_TIMEOUT_MS);
    this.map.on('error', (e) => {
      // A failure to load the basemap style itself switches to the offline fallback.
      if (!this.styleLoaded && !this.fallback && !e.sourceId) this.useFallbackStyle(e.error?.message || 'basemap error');
    });
    this.map.on('style.load', () => this.onStyleLoad());
    this.map.on('click', (e) => this.onClick(e));
    this.map.on('mousemove', (e) => {
      const hit = this.map.queryRenderedFeatures(e.point, { layers: this.existing(INTERACTIVE) }).length > 0;
      this.map.getCanvas().style.cursor = hit ? 'pointer' : '';
    });
    this.map.on('moveend', () => this.opts.onMove?.(this.getView()));
    return this;
  }

  existing(ids) {
    return ids.filter((id) => this.map.getLayer(id));
  }

  async useFallbackStyle(reason) {
    if (this.fallback) return;
    this.fallback = true;
    this.hasGlyphs = false;
    clearTimeout(this.styleTimer);
    console.warn(`Basemap unavailable (${reason}); using offline country outlines.`);
    this.opts.onBasemapFallback?.(reason);
    let countries = EMPTY;
    try {
      countries = await loadCountries();
    } catch {
      /* draw an empty background rather than failing */
    }
    const dark = this.theme === 'dark';
    this.map.setStyle({
      version: 8,
      sources: { countries: { type: 'geojson', data: countries, attribution: 'Country outlines: Natural Earth' } },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': dark ? '#0e1622' : '#dfe8ef' } },
        { id: 'land', type: 'fill', source: 'countries', paint: { 'fill-color': dark ? '#1c2633' : '#f7f7f4' } },
        { id: 'borders', type: 'line', source: 'countries', paint: { 'line-color': dark ? '#3b4a5c' : '#b9c2cc', 'line-width': 0.6 } },
      ],
    }, { diff: false });
  }

  setTheme(theme) {
    if (theme === this.theme) return;
    this.theme = theme;
    if (this.fallback) {
      this.fallback = false;
      this.useFallbackStyle('theme change');
    } else {
      this.styleLoaded = false;
      this.map.setStyle(BASEMAPS[theme] || BASEMAPS.light, { diff: false });
    }
  }

  onStyleLoad() {
    this.styleLoaded = true;
    clearTimeout(this.styleTimer);
    registerIcons(this.map);
    this.addLayers();
    for (const [cat, visible] of Object.entries(this.visibility)) this.setVisibility(cat, visible);
    if (this.selection) this.setSelection(this.selection);
    this.opts.onReady?.();
  }

  firstSymbolLayer() {
    // Insert data below basemap labels so place names stay readable.
    return this.map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
  }

  addSource(id, extra = {}) {
    if (!this.map.getSource(id)) this.map.addSource(id, { type: 'geojson', data: this.data[id] || EMPTY, ...extra });
  }

  addLayers() {
    const m = this.map;
    const below = this.firstSymbolLayer();
    const text = this.hasGlyphs;
    const halo = this.theme === 'dark' ? '#0b1118' : '#ffffff';
    const textColor = this.theme === 'dark' ? '#e8edf3' : '#1b2430';

    this.addSource('gim-nws');
    this.addSource('gim-gdacs-areas');
    this.addSource('gim-gdacs-tracks');
    this.addSource('gim-gdacs-points');
    this.addSource('gim-eonet-points');
    this.addSource('gim-eonet-areas');
    this.addSource('gim-eonet-tracks');
    this.addSource('gim-fires-summary');
    this.addSource('gim-fires-detail');
    this.addSource('gim-eq-minor', { cluster: true, clusterMaxZoom: 6, clusterRadius: 38 });
    this.addSource('gim-eq-major');
    this.addSource('gim-selection');

    const colorExpr = ['match', ['get', 'color'], ...Object.entries(HINT_COLORS).flat(), HINT_COLORS.gray];

    // Area layers (below labels). Affected areas are tinted and textured by
    // hazard type (flood "pixels", storm wind streaks, flames, …); NWS polygons
    // keep their severity colour and get the hazard texture on top.
    const pattern = ['concat', 'pat-', ['get', 'hazard']];
    m.addLayer({ id: 'gim-nws-fill', type: 'fill', source: 'gim-nws', paint: { 'fill-color': colorExpr, 'fill-opacity': ['match', ['get', 'color'], 'red', 0.26, 'orange', 0.2, 0.13] } }, below);
    m.addLayer({ id: 'gim-nws-pattern', type: 'fill', source: 'gim-nws', filter: ['has', 'hazard'], paint: { 'fill-pattern': pattern, 'fill-opacity': 0.85 } }, below);
    m.addLayer({ id: 'gim-nws-line', type: 'line', source: 'gim-nws', paint: { 'line-color': colorExpr, 'line-width': 1.2, 'line-opacity': 0.85 } }, below);
    for (const src of ['gdacs', 'eonet']) {
      m.addLayer({ id: `gim-${src}-area-fill`, type: 'fill', source: `gim-${src}-areas`, paint: { 'fill-color': ['get', 'hcolor'], 'fill-opacity': 0.16 } }, below);
      m.addLayer({ id: `gim-${src}-area-pattern`, type: 'fill', source: `gim-${src}-areas`, paint: { 'fill-pattern': pattern, 'fill-opacity': 0.9 } }, below);
      m.addLayer({ id: `gim-${src}-area-line`, type: 'line', source: `gim-${src}-areas`, paint: { 'line-color': ['get', 'hcolor'], 'line-width': 1.6, 'line-dasharray': [3, 2] } }, below);
      // Tracks and their arrows appear from regional zoom, to keep the world view clean.
      m.addLayer({ id: `gim-${src}-track`, type: 'line', source: `gim-${src}-tracks`, minzoom: 2.5, paint: { 'line-color': ['get', 'hcolor'], 'line-width': 2.4, 'line-dasharray': [1, 1.5] } }, below);
      // Arrows along a storm's path show its direction of travel (towards the latest position).
      m.addLayer({
        id: `gim-${src}-track-arrows`,
        type: 'symbol',
        source: `gim-${src}-tracks`,
        minzoom: 2.5,
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 160,
          'icon-image': 'track-arrow',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 1, 0.6, 6, 0.95],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: { 'icon-color': ['get', 'hcolor'], 'icon-halo-color': halo, 'icon-halo-width': 1.5 },
      });
      // Events with only a point get a soft glow in the hazard colour — it marks
      // "around here" without drawing a boundary the source never published.
      m.addLayer(
        {
          id: `gim-${src}-glow`,
          type: 'circle',
          source: `gim-${src}-points`,
          filter: ['!', ['get', 'hasArea']],
          paint: {
            'circle-color': ['get', 'hcolor'],
            'circle-blur': 1,
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 16, 4, 30, 7, 60, 10, 110],
            'circle-opacity': ['case', ['get', 'representative'], 0.55, 0.4],
          },
        },
        below,
      );
    }

    // Selection radius.
    m.addLayer({ id: 'gim-selection-fill', type: 'fill', source: 'gim-selection', paint: { 'fill-color': '#3a7bd5', 'fill-opacity': 0.06 } });
    m.addLayer({ id: 'gim-selection-line', type: 'line', source: 'gim-selection', paint: { 'line-color': '#3a7bd5', 'line-width': 1.6, 'line-dasharray': [2, 2] } });

    // Thermal detections: aggregated cells at low zoom, individual detections closer in.
    m.addLayer({
      id: 'gim-fires-summary',
      type: 'circle',
      source: 'gim-fires-summary',
      maxzoom: 5,
      paint: {
        'circle-color': FIRE_COLORS.medium,
        'circle-opacity': 0.55,
        'circle-stroke-color': FIRE_COLORS.strong,
        'circle-stroke-width': 0.8,
        'circle-radius': ['interpolate', ['linear'], ['sqrt', ['get', 'count']], 1, 2.5, 5, 6, 20, 13, 60, 22],
      },
    });
    if (text) {
      m.addLayer({
        id: 'gim-fires-summary-count',
        type: 'symbol',
        source: 'gim-fires-summary',
        maxzoom: 5,
        filter: ['>=', ['get', 'count'], 25],
        layout: { 'text-field': ['get', 'countLabel'], 'text-font': FONT, 'text-size': 10, 'text-allow-overlap': false },
        paint: { 'text-color': '#3b1a00', 'text-halo-color': '#ffe8cc', 'text-halo-width': 1 },
      });
    }
    m.addLayer({
      id: 'gim-fires-detail',
      type: 'circle',
      source: 'gim-fires-detail',
      minzoom: 5,
      paint: {
        'circle-color': ['match', ['get', 'tone'], 'strong', FIRE_COLORS.strong, 'medium', FIRE_COLORS.medium, FIRE_COLORS.weak],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2.2, 9, 4, 13, 7],
        'circle-opacity': 0.85,
        'circle-stroke-color': '#5a2300',
        'circle-stroke-width': 0.4,
      },
    });

    // Earthquakes: clustered minor events, always-visible major events.
    const magRadius = ['interpolate', ['linear'], ['get', 'mag'], 0, 2.5, 3, 4.5, 4.5, 7, 5, 9, 6, 13, 7, 18, 8, 23];
    m.addLayer({
      id: 'gim-eq-cluster',
      type: 'circle',
      source: 'gim-eq-minor',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': HINT_COLORS.blue,
        'circle-opacity': 0.55,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1,
        'circle-radius': ['step', ['get', 'point_count'], 9, 10, 12, 50, 16, 200, 20],
      },
    });
    if (text) {
      m.addLayer({
        id: 'gim-eq-cluster-count',
        type: 'symbol',
        source: 'gim-eq-minor',
        filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': FONT, 'text-size': 11 },
        paint: { 'text-color': '#ffffff' },
      });
    }
    const pointPaint = {
      'circle-color': colorExpr,
      'circle-radius': magRadius,
      'circle-opacity': 0.82,
      'circle-stroke-color': halo,
      'circle-stroke-width': 1.2,
    };
    m.addLayer({ id: 'gim-eq-minor', type: 'circle', source: 'gim-eq-minor', filter: ['!', ['has', 'point_count']], paint: pointPaint });
    m.addLayer({ id: 'gim-eq-major', type: 'circle', source: 'gim-eq-major', paint: { ...pointPaint, 'circle-stroke-width': 1.6 } });
    if (text) {
      const labelLayout = { 'text-field': ['get', 'label'], 'text-font': FONT, 'text-size': 11, 'text-offset': [0, 1.35], 'text-anchor': 'top', 'text-optional': true };
      const labelPaint = { 'text-color': textColor, 'text-halo-color': halo, 'text-halo-width': 1.4 };
      m.addLayer({ id: 'gim-eq-major-label', type: 'symbol', source: 'gim-eq-major', minzoom: 2, layout: labelLayout, paint: labelPaint });
      m.addLayer({ id: 'gim-eq-minor-label', type: 'symbol', source: 'gim-eq-minor', minzoom: 7, filter: ['!', ['has', 'point_count']], layout: labelLayout, paint: labelPaint });
    }

    // GDACS and EONET events: hazard icon on top, ringed by the GDACS alert
    // level as published (EONET publishes none, so its ring is neutral teal).
    for (const src of ['gdacs', 'eonet']) {
      m.addLayer({
        id: `gim-${src}-halo`,
        type: 'circle',
        source: `gim-${src}-points`,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 12, 6, 17],
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': src === 'gdacs' ? colorExpr : NATURAL_COLOR,
          'circle-stroke-width': src === 'gdacs' ? 3 : 2,
          'circle-stroke-opacity': ['case', ['get', 'representative'], 0.6, 1],
        },
      });
      m.addLayer({
        id: `gim-${src}-icon`,
        type: 'symbol',
        source: `gim-${src}-points`,
        layout: {
          'icon-image': ['concat', 'hz-', ['get', 'hazard']],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 1, 0.5, 6, 0.75],
          'icon-allow-overlap': true,
        },
      });
    }
  }

  setData(sourceId, fc) {
    this.data[sourceId] = fc;
    const src = this.map?.getSource(sourceId);
    if (src) src.setData(fc);
  }

  setVisibility(category, visible) {
    this.visibility[category] = visible;
    if (!this.map) return;
    // Layers that do not exist yet get this visibility when they are added (onStyleLoad).
    for (const id of CATEGORY_LAYERS[category] || []) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
  }

  setSelection(sel) {
    this.selection = sel;
    const fc = sel ? { type: 'FeatureCollection', features: [circlePolygon(sel.lon, sel.lat, sel.radiusKm)] } : EMPTY;
    this.setData('gim-selection', fc);
    if (!sel) {
      this.marker?.remove();
      this.marker = null;
      return;
    }
    if (!this.marker) {
      const el = document.createElement('div');
      el.className = 'selection-marker';
      el.setAttribute('aria-hidden', 'true');
      this.marker = new this.ml.Marker({ element: el, anchor: 'center' });
    }
    this.marker.setLngLat([sel.lon, sel.lat]).addTo(this.map);
  }

  onClick(e) {
    const features = this.map.queryRenderedFeatures(e.point, { layers: this.existing(INTERACTIVE) });
    if (!features.length) {
      this.opts.onSelect?.(e.lngLat.lng, e.lngLat.lat);
      return;
    }
    const order = (f) => INTERACTIVE.indexOf(f.layer.id);
    const f = features.sort((a, b) => order(a) - order(b))[0];
    if (f.layer.id === 'gim-eq-cluster') {
      this.map.getSource('gim-eq-minor').getClusterExpansionZoom(f.properties.cluster_id).then((zoom) => {
        this.easeTo({ center: f.geometry.coordinates, zoom: Math.min(zoom, 10) });
      });
      return;
    }
    if (f.layer.id === 'gim-fires-summary') {
      this.easeTo({ center: f.geometry.coordinates, zoom: 6 });
      return;
    }
    this.opts.onFeatureClick?.(f, e.lngLat);
  }

  easeTo(opts) {
    if (prefersReducedMotion()) this.map.jumpTo(opts);
    else this.map.easeTo({ ...opts, duration: 700 });
  }

  flyTo(lon, lat, zoom) {
    const opts = { center: [lon, lat], zoom: zoom ?? Math.max(this.map.getZoom(), 6) };
    if (prefersReducedMotion()) this.map.jumpTo(opts);
    else this.map.flyTo({ ...opts, speed: 1.6, essential: false });
  }

  fitRadius(lon, lat, radiusKm) {
    const zoom = Math.max(2, Math.min(11, Math.log2((EARTH_RADIUS_KM * 2 * Math.PI) / (radiusKm * 4.2)) - 0.2));
    this.flyTo(lon, lat, zoom);
  }

  /**
   * Download basemap tiles around a place so it can be drawn offline (the
   * service worker caches them). Bounded to `maxTiles` across zoom levels.
   */
  async prefetchArea(lon, lat, radiusKm, { maxTiles = 350, maxZoom = 12 } = {}) {
    if (this.fallback || !this.map) return 0;
    const templates = [];
    for (const id of Object.keys(this.map.getStyle()?.sources || {})) {
      const src = this.map.getSource(id);
      if (src?.type === 'vector' && Array.isArray(src.tiles)) templates.push(...src.tiles);
    }
    if (!templates.length) return 0;
    const dLat = (radiusKm / EARTH_RADIUS_KM) * (180 / Math.PI);
    const dLon = dLat / Math.max(0.05, Math.cos((lat * Math.PI) / 180));
    const tileXY = (lo, la, z) => {
      const n = 2 ** z;
      const r = (Math.max(-85, Math.min(85, la)) * Math.PI) / 180;
      return [Math.floor(((lo + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)];
    };
    const urls = [];
    for (let z = 2; z <= maxZoom; z++) {
      const [x0, y0] = tileXY(lon - dLon, lat + dLat, z);
      const [x1, y1] = tileXY(lon + dLon, lat - dLat, z);
      const level = [];
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (const t of templates) level.push(t.replace('{z}', z).replace('{x}', ((x % 2 ** z) + 2 ** z) % 2 ** z).replace('{y}', y));
      if (urls.length + level.length > maxTiles) break;
      urls.push(...level);
    }
    let done = 0;
    const queue = [...urls];
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        while (queue.length) {
          const u = queue.shift();
          try {
            if ((await fetch(u)).ok) done++;
          } catch {
            /* offline or blocked — skip */
          }
        }
      }),
    );
    return done;
  }

  /** Keep the bottom sheet from covering the map centre (mobile). */
  setBottomPadding(px) {
    this.map?.setPadding({ top: 0, right: 0, left: 0, bottom: Math.max(0, Math.round(px)) });
  }

  setView(view) {
    if (view) this.easeTo({ center: view.center, zoom: view.zoom });
  }

  centerOn(lon, lat) {
    this.easeTo({ center: [lon, lat] });
  }

  resetWorld() {
    this.easeTo({ center: WORLD_VIEW.center, zoom: WORLD_VIEW.zoom });
  }

  getView() {
    const c = this.map.getCenter();
    return { center: [c.lng, c.lat], zoom: this.map.getZoom() };
  }

  getBbox() {
    const b = this.map.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  }

  getZoom() {
    return this.map.getZoom();
  }

  popup(lngLat, element) {
    this.currentPopup?.remove();
    // Anchor the popup above the feature and move the feature towards the lower
    // part of the view so the whole popup fits on screen.
    const height = this.map.getContainer().clientHeight;
    this.easeTo({ center: lngLat, offset: [0, Math.round(height * 0.28)] });
    // The header (type, title, close) stays fixed at the top while details scroll.
    const close = closeButtonElement('Close details');
    (element.querySelector('.detail-head') || element).append(close);
    this.currentPopup = new this.ml.Popup({ maxWidth: '300px', anchor: 'bottom', closeButton: false, focusAfterOpen: false, className: 'incident-popup' })
      .setLngLat(lngLat)
      .setDOMContent(element)
      .addTo(this.map);
    const popup = this.currentPopup;
    close.addEventListener('click', () => popup.remove());
    close.focus({ preventScroll: true });
    return popup;
  }

  closePopup() {
    this.currentPopup?.remove();
  }

  resize() {
    this.map?.resize();
  }
}
