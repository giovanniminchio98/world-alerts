// Viewer preferences, stored only in this browser.
import { load, save } from './storage.js';

const DEFAULTS = { units: 'km', timeMode: 'local', theme: 'system', projection: 'mercator' };
let prefs = { ...DEFAULTS, ...load('prefs', {}) };
const listeners = new Set();

export const getPrefs = () => prefs;

export function setPref(key, value) {
  prefs = { ...prefs, [key]: value };
  save('prefs', prefs);
  for (const l of listeners) l(prefs, key);
}

export function onPrefsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Apply the theme preference to <html data-theme>. */
export function applyTheme(theme = prefs.theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}

export function effectiveTheme() {
  if (prefs.theme === 'light' || prefs.theme === 'dark') return prefs.theme;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
