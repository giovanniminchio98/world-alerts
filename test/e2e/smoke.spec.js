import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Basemap tiles and the public geocoder are external; keep tests offline and deterministic.
  await page.route(/tiles\.openfreemap\.org|nominatim\.openstreetmap\.org/, (route) => route.abort());
});

test('loads the map shell with disclaimer, demo banner and source freshness', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#demo-banner')).toBeVisible();
  await expect(page.locator('#notice')).toContainText('It is not an emergency warning system');
  await expect(page.locator('#status-strip')).toContainText('5 of 5 sources updated');
  await page.click('[data-open-status]');
  await expect(page.locator('#status-dialog')).toBeVisible();
  await expect(page.locator('#status-dialog .status-rows li')).toHaveCount(5);
  await expect(page.locator('#status-dialog')).toContainText('Last published update');
  await page.click('#status-dialog [data-close]');
  await expect(page.locator('#status-dialog')).toBeHidden();
});

test('city search selects a place and shows the location status card', async ({ page }) => {
  await page.goto('./');
  await page.fill('#search-input', 'Hualien');
  await expect(page.locator('#search-results .search-opt').first()).toContainText('Hualien');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const card = page.locator('#location-panel');
  await expect(card).toBeVisible();
  await expect(card.locator('h2')).toContainText('Hualien');
  await expect(card.locator('.summary-box')).toContainText('monitored incident');
  await expect(card).toContainText('M 6.1'); // high severity → expanded by default
  await expect(card).toContainText('Absence of a listed event does not confirm that no disruption exists');
  await expect(page).toHaveURL(/lat=.*lon=.*place=Hualien/);
});

test('a place without nearby events uses neutral empty-result language', async ({ page }) => {
  await page.goto('./?lat=48.8566&lon=2.3522&place=Paris&cc=FR&r=50');
  const summary = page.locator('#location-panel .summary-box');
  await expect(summary).toHaveText('No matching incidents were detected by the connected sources for this area and selected time window.');
  await expect(page.locator('#location-panel')).toContainText('Coverage unavailable for this area');
  await expect(page.locator('#location-panel')).toContainText('Not covered yet');
  await expect(page.locator('#location-panel')).toContainText('Electricity outages');
  await expect(page.locator('#location-panel')).not.toContainText(/\bsafe\b/i);
});

test('US location inside an NWS alert and changing the radius', async ({ page }) => {
  await page.goto('./?lat=29.76&lon=-95.37&place=Houston&cc=US');
  const card = page.locator('#location-panel');
  await expect(card.locator('.cat-expand').first()).toBeVisible();
  await expect(card).toContainText('Flood Warning');
  await expect(card).toContainText('inside the area published by the source');
  await card.locator('#radius-select').selectOption('500');
  await expect(page).toHaveURL(/r=500/);
});

test('clicking the map selects a location', async ({ page, isMobile }) => {
  test.skip(isMobile, 'covered on desktop');
  await page.goto('./#map=4/0/-30');
  await page.waitForTimeout(2500);
  const box = await page.locator('#map').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('#location-panel')).toBeVisible();
  await expect(page.locator('#location-panel .summary-box')).toBeVisible();
});

test('layer toggles and filters', async ({ page, isMobile }) => {
  await page.goto('./');
  if (isMobile) await page.click('#btn-layers');
  await expect(page.locator('#panel-title')).toHaveText('Layers & filters');
  const eq = page.locator('[data-layer="earthquake"]');
  await expect(eq).toBeChecked();
  await eq.dispatchEvent('click');
  await expect(eq).not.toBeChecked();
  await page.goto('./');
  if (isMobile) await page.click('#btn-layers');
  await expect(page.locator('[data-layer="earthquake"]')).not.toBeChecked(); // remembered in this browser
});

test('sources page lists every source with status and timestamps', async ({ page }) => {
  await page.goto('./sources.html');
  await expect(page.locator('.source-card')).toHaveCount(10); // 9 sources + the publication summary box
  await expect(page.locator('#usgs-earthquakes')).toContainText('Last successful fetch');
  await expect(page.locator('#power-outages')).toContainText('Not connected');
});

test('closing the card restores the previous map view', async ({ page }) => {
  await page.goto('./#map=2/20/10');
  await page.waitForTimeout(2000);
  await page.fill('#search-input', 'Hualien');
  await expect(page.locator('#search-results .search-opt').first()).toContainText('Hualien');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('#location-panel')).toBeVisible();
  await page.waitForTimeout(2500);
  await page.click('[data-action="close"]');
  await page.waitForTimeout(1500);
  await expect(page).toHaveURL(/#map=2\.00\/20\.0000\/10\.0000/);
});

test('thermal detections start collapsed and expand on demand', async ({ page }) => {
  await page.goto('./?lat=-10.5&lon=-63&place=Rondonia&cc=BR&w=7d');
  const card = page.locator('#location-panel');
  await expect(card).toContainText('possible fires, crop burning or industrial heat');
  const btn = card.locator('.cat-expand', { hasText: 'nearest detections' });
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  await expect(card.locator('.event-title', { hasText: 'Heat detection' }).first()).toBeVisible();
});

test('the map keeps its height after the disclaimer is dismissed', async ({ page }) => {
  await page.goto('./');
  await page.click('[data-dismiss]');
  await page.waitForTimeout(500);
  const map = await page.locator('#map').boundingBox();
  const strip = await page.locator('#status-strip').boundingBox();
  const viewport = page.viewportSize();
  expect(map.height).toBeGreaterThan(viewport.height * 0.45);
  expect(strip.y + strip.height).toBeGreaterThan(viewport.height - 5); // strip stays at the bottom
});

test('emergency numbers are shown for the selected country', async ({ page }) => {
  await page.goto('./?lat=13.75&lon=100.5&place=Bangkok&cc=TH');
  const em = page.locator('#location-panel .emergency');
  await expect(em).toContainText('Emergency numbers · Thailand');
  await expect(em.locator('a[href="tel:191"]')).toContainText('191');
  await expect(em).toContainText('confirm locally');
});

test('natural events (NASA EONET) appear in the card', async ({ page }) => {
  await page.goto('./?lat=34.05&lon=-118.24&place=Los%20Angeles&cc=US');
  const row = page.locator('#location-panel .cat-row[data-cat="natural"]');
  await expect(row).toContainText('Natural events');
  await expect(row).toContainText('relevant event');
});

test('works offline after a place is saved', async ({ page, context, isMobile }) => {
  test.skip(isMobile, 'covered on desktop');
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now controlled by the service worker
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.goto('./?lat=29.76&lon=-95.37&place=Houston&cc=US');
  await expect(page.locator('#location-panel .summary-box')).toBeVisible();
  await page.click('[data-action="save"]');
  await expect(page.locator('[data-action="save"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#saved-places')).toContainText('Houston');
  await page.waitForLoadState('networkidle'); // let in-flight requests settle, as a real user would

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#offline-banner')).toContainText("You're offline");
  await page.locator('#saved-places .saved-open').first().click();
  const card = page.locator('#location-panel');
  await expect(card).toContainText('Flood Warning');
  await expect(card.locator('.emergency a[href="tel:911"]')).toBeVisible();
  await context.setOffline(false);
});

test('time window chip on the map; choice is kept on reload, first visit is 24 h', async ({ page, context }) => {
  await page.goto('./');
  const chip = page.locator('#window-chip');
  await expect(chip).toContainText('Last 24 hours');
  await chip.click();
  await page.click('#window-menu [data-window="7d"]');
  await expect(chip).toContainText('Last 7 days');
  await expect(page.locator('#window-menu')).toBeHidden();
  await page.reload();
  await expect(page.locator('#window-chip')).toContainText('Last 7 days');
  // A brand-new visitor (no stored choice, plain URL) starts at 24 hours.
  const fresh = await context.browser().newContext();
  const p2 = await fresh.newPage();
  await p2.goto(new URL('./', page.url()).href.split('?')[0]);
  await expect(p2.locator('#window-chip')).toContainText('Last 24 hours');
  await fresh.close();
});
