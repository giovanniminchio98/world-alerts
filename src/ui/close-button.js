// One close (X) button used everywhere: popups, location card, menu, dialogs.
// An SVG cross (not a text glyph) so it is centred identically in every place.
import { html, raw } from '../lib/dom.js';

export const CLOSE_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';

export const closeButtonHtml = (label, attrs = '') =>
  html`<button type="button" class="close-btn" aria-label="${label}" title="Close" ${raw(attrs)}>${raw(CLOSE_ICON)}</button>`;

export function closeButtonElement(label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'close-btn';
  b.setAttribute('aria-label', label);
  b.title = 'Close';
  b.innerHTML = CLOSE_ICON;
  return b;
}
