// Small page-chrome helpers: first-visit notice and toast messages.
import { load, save } from '../lib/storage.js';

export function initChrome() {
  const notice = document.getElementById('notice');
  if (notice && !load('noticeDismissed', false)) {
    notice.hidden = false;
    notice.querySelector('[data-dismiss]')?.addEventListener('click', () => {
      notice.hidden = true;
      save('noticeDismissed', true);
    });
  }
}

let toastTimer;
export function toast(message, ms = 4500) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, ms);
}
