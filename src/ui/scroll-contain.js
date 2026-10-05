// Keep a swipe inside a scrolling box (map popup, location card, layers panel).
// CSS `overscroll-behavior: contain` covers most browsers, but iOS Safari can
// still hand a hard swipe to the page once the box reaches its top or bottom,
// which moves the whole app. Here a one-finger swipe that would go past either
// end is stopped, so only the box itself ever scrolls.

export function containTouchScroll(el) {
  if (!el || el.dataset.scrollContained) return;
  el.dataset.scrollContained = '1';
  let startY = 0;
  let startX = 0;
  el.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
    },
    { passive: true },
  );
  el.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length !== 1) return; // leave pinch-zoom alone
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;
      if (Math.abs(dx) > Math.abs(dy)) return; // horizontal swipes (e.g. wide tables) are not chained vertically
      const max = el.scrollHeight - el.clientHeight;
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop >= max - 1;
      if (max <= 1 || (dy > 0 && atTop) || (dy < 0 && atBottom)) e.preventDefault();
    },
    { passive: false },
  );
}
