# Manual test plan

Automated coverage: `npm test` (unit) and `npm run test:e2e` (Playwright, desktop + mobile).
The steps below cover what automation cannot judge well (visual clarity, wording, real data).

Start with sample data unless a step says otherwise:

```bash
npm install
npm run dev            # http://localhost:5173 — purple "Sample data" banner must be visible
```

## 1. City search

1. Type `hual` in the search box. Suggestions appear instantly (from the bundled city list) — **no network request** to Nominatim should appear in DevTools → Network while typing.
2. Use ↓ / Enter to pick *Hualien City, Taiwan*. The map flies to Taiwan, a dashed radius circle appears, and the Location Status card opens.
3. Type a small place not in the city list (e.g. `Grindavík`) and press **Enter**. One request goes to `nominatim.openstreetmap.org`; results list name, country and coordinates. Repeating the same search does not send a second request (cached).
4. Each result shows place name, country and coordinates.

## 2. Map click selection

1. Click open ocean in the mid-Atlantic. The card says “Selected point”, “No country found (possibly at sea)”, and the no-match summary.
2. Click near Lyon, France. The card title reads “Near Lyon” with “About N km … of Lyon, France”.
3. Click an earthquake circle → a popup shows magnitude, time, depth, tsunami flag, distance and a USGS link. Click a GDACS icon → alert level as published and the representative-location note where applicable.
4. Click a cluster → the map zooms in and the cluster expands.

## 3. Layer filtering

1. Toggle *Earthquakes* off/on — circles disappear/reappear; the location card still lists earthquakes (cards check all sources).
2. Set *Minimum magnitude* to M 4.5+ — small events disappear from map, list and card; the card shows “Active filters: earthquakes M 4.5+”.
3. Switch the time window between 1 h / 24 h / 48 h / 7 days — counts change consistently in the map, list and card.
4. Satellite heat spots are off by default. Switch the layer on, then zoom into the Amazon (≈ 10° S, 63° W) past zoom 5 — the 1° thermal summary circles are replaced by individual detections; change *Confidence* to “High only”.

## 3b. Natural events, emergency numbers, offline

1. `/?lat=34.05&lon=-118.24&place=Los%20Angeles&cc=US` — the teal *Natural events* row lists the sample wildfire; the card shows *Emergency numbers · United States: 911* as a tap-to-call link.
2. `/?lat=13.75&lon=100.5&place=Bangkok&cc=TH` — police 191, ambulance 1669, fire 199.
3. Production build only (`npm run build && npm run preview`): open the site, reload once, pick a city and tap **☆ Save for offline**. It appears under *Saved places* in the layers panel. In DevTools → Network choose *Offline* and reload: the offline banner appears, the saved place opens with its card and emergency numbers, and timestamps still show when the data was published.

## 4. Mobile layout

Use DevTools device mode (e.g. 390 × 844) or a phone on the same network (`npm run dev -- --host`).

1. The search box spans the width; the map fills the screen; no horizontal scrolling.
2. ☰ opens the layers drawer; ✕ or Escape closes it.
3. Selecting a place opens a bottom sheet; the handle expands/collapses it.
4. Buttons are at least ~36–40 px and usable by touch.

## 5. Source stale state

```bash
DATA_SOURCE=fixtures SIMULATE=firms-hotspots=stale npm run dev
```

- The FIRMS chip and layer show amber **Stale** and “Data may be stale — last successful project update …”.
- Location cards still show detections, with “Data is stale; last successful refresh was …”.

## 6. Source failure state

```bash
DATA_SOURCE=fixtures SIMULATE=gdacs-disasters=failed,nws-alerts=nodata npm run dev
```

- GDACS: red **Refresh failed**, “This source could not be refreshed. Showing last valid data from …”; its events are still on the map.
- NWS: **Refresh failed** with “No data currently available”; a US location card shows “Source temporarily unavailable — no data currently available.”
- The sources page shows the error text under *Diagnostics*. The map shows no alarming error banners.

## 7. Empty-result language

Open `/?lat=48.8566&lon=2.3522&place=Paris&cc=FR&r=50`:

- Summary: “No matching incidents were detected by the connected sources for this area and selected time window.”
- Coverage note: “Absence of a listed event does not confirm that no disruption exists…”
- The words “safe”, “no danger”, “no problems” or “everything is normal” never appear.

## 8. Example locations (sample data)

| Scenario | URL | Expect |
| --- | --- | --- |
| City near a recent earthquake | `/?lat=23.99&lon=121.6&place=Hualien&cc=TW` | M 6.1 ≈ 11 km east, GDACS Orange (inside area), high-severity line |
| City without nearby events | `/?lat=48.8566&lon=2.3522&place=Paris&cc=FR` | No-match summary |
| Area with thermal detections | `/?lat=-10.5&lon=-63&place=Rond%C3%B4nia&cc=BR&w=7d` | Thermal row with counts, nearest detections, “not necessarily wildfires” |
| US location with an NWS alert | `/?lat=29.76&lon=-95.37&place=Houston&cc=US` | Flood Warning, “inside the area published by the source” |
| Unsupported power/Internet coverage | any location | “No electricity-outage data source is currently connected for this location.” |
| NWS outside the US | Paris URL above | Weather row: “Coverage unavailable for this area” |
| Country-level GDACS match | `/?lat=22.36&lon=91.83&place=Chittagong&cc=BD` | Flood listed as “Country-level: source lists Bangladesh as affected” |

## 9. Live data check (needs network)

```bash
npm run refresh:force && npm run dev
```

- The demo banner is gone; sources page shows real fetch times and record counts.
- Pick a recent significant earthquake from https://earthquake.usgs.gov/ and confirm it appears with the same magnitude/time and that its link opens the USGS event page.

## 10. Accessibility spot checks

- Tab through the page: skip link → search → buttons → panel controls → map → card. Focus is always visible.
- With a screen reader, selecting a place announces the card summary (live region).
- Enable “reduce motion” in the OS — map transitions jump instead of animating.
- Severity is readable without colour (labels like “M 6.1”, “Orange alert”, “Severe”).
