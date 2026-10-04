import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Basemap tiles and the public geocoder are external; keep tests offline and deterministic.
  await page.route(/tiles\.openfreemap\.org|nominatim\.openstreetmap\.org/, (route) => route.abort());
});

test('loads the map shell with disclaimer, demo banner and source freshness', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#demo-banner')).toBeVisible();
  await expect(page.locator('#notice')).toContainText('It is not an emergency warning system');
  await expect(page.locator('#status-strip')).toContainText('Last published update');
  await expect(page.locator('#status-strip .chip')).toHaveCount(4);
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
  await expect(card).toContainText('M 6.1');
  await expect(card).toContainText('Absence of a listed event does not confirm that no disruption exists');
  await expect(page).toHaveURL(/lat=.*lon=.*place=Hualien/);
});

test('a place without nearby events uses neutral empty-result language', async ({ page }) => {
  await page.goto('./?lat=48.8566&lon=2.3522&place=Paris&cc=FR&r=50');
  const summary = page.locator('#location-panel .summary-box');
  await expect(summary).toHaveText('No matching incidents were detected by the connected sources for this area and selected time window.');
  await expect(page.locator('#location-panel')).toContainText('Coverage unavailable for this area');
  await expect(page.locator('#location-panel')).toContainText('No electricity-outage data source is currently connected for this location.');
  await expect(page.locator('#location-panel')).not.toContainText(/\bsafe\b/i);
});

test('US location inside an NWS alert and changing the radius', async ({ page }) => {
  await page.goto('./?lat=29.76&lon=-95.37&place=Houston&cc=US');
  const card = page.locator('#location-panel');
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
