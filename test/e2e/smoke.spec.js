import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Basemap tiles and the public geocoder are external; keep tests offline and deterministic.
  await page.route(/tiles\.openfreemap\.org|nominatim\.openstreetmap\.org/, (route) => route.abort());
});

test('loads the map shell with disclaimer, demo banner and source freshness', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#demo-banner')).toBeVisible();
  await expect(page.locator('#notice')).toContainText('It is not an emergency warning system');
  await expect(page.locator('#status-strip')).toContainText('4 of 4 sources updated');
  await page.click('[data-open-status]');
  await expect(page.locator('#status-dialog')).toBeVisible();
  await expect(page.locator('#status-dialog .status-rows li')).toHaveCount(4);
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

test('layer filters and incident list', async ({ page, isMobile }) => {
  await page.goto('./');
  if (isMobile) await page.click('#btn-layers');
  await page.click('#tabbtn-list');
  const list = page.locator('#incident-list');
  await expect(list).toContainText('mapped incident');
  const before = await list.locator('li').count();
  await page.click('#tabbtn-layers');
  await page.locator('[data-layer="earthquake"]').uncheck({ force: true });
  await page.click('#tabbtn-list');
  await expect(list).toContainText('Hidden layers: earthquake');
  expect(await list.locator('li').count()).toBeLessThan(before);
});

test('sources page lists every source with status and timestamps', async ({ page }) => {
  await page.goto('./sources.html');
  await expect(page.locator('.source-card')).toHaveCount(9); // 8 sources + the publication summary box
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
