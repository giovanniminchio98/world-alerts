// Visual identity per incident category: an icon and a colour that evokes the
// hazard (earth brown, crimson alert, fire orange, weather blue). Colours are
// CSS tokens (--cat-*) so they adapt to light and dark themes.
import { raw } from '../lib/dom.js';

const svg = (body) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICONS = {
  // seismograph trace
  earthquake: svg('<path d="M2 12h4l2-6 3 12 3-9 2 3h6"/>'),
  // warning triangle
  disaster: svg('<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>'),
  // flame
  thermal: svg('<path d="M12 3c3 4 6 6.5 6 10.5a6 6 0 0 1-12 0C6 10 8.5 9 9 6c1.5 1.5 2 3 2 4.5C12.5 9 13 6 12 3z"/>'),
  // globe (NASA EONET natural events)
  natural: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-3 3.5-3 14.5 0 18M12 3c3 3.5 3 14.5 0 18"/>'),
  // cloud with rain
  weather: svg('<path d="M7 15a4 4 0 0 1 .5-8 5 5 0 0 1 9.5 1.5A3.5 3.5 0 0 1 17 15H7z"/><path d="M9 18l-1 2M13 18l-1 2M17 18l-1 2"/>'),
  // plug (not-connected categories)
  other: svg('<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8z"/><path d="M12 17v4"/>'),
};

export const categoryIcon = (category) => raw(ICONS[category] || ICONS.other);
