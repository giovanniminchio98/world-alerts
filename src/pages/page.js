// Shared bootstrap for content pages.
import '../styles/main.css';
import { applyTheme } from '../lib/prefs.js';

applyTheme();
const here = location.pathname.split('/').pop() || 'index.html';
for (const a of document.querySelectorAll('.nav-link')) {
  if (a.getAttribute('href').replace('./', '') === here) a.setAttribute('aria-current', 'page');
}
