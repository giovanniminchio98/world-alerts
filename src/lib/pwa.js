// Service worker registration (production builds only) and connectivity banner.
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((e) => console.warn('Service worker not registered:', e));
  });
}

/** Show/hide the offline banner; `describe()` returns the text to show while offline. */
export function watchConnectivity(banner, describe) {
  const update = () => {
    const offline = navigator.onLine === false;
    banner.hidden = !offline;
    if (offline) banner.textContent = describe();
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
  return update;
}
