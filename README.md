# Global Incident Map

**“What is happening around this place right now?”**

A static website that puts recent public incident and disruption data on an interactive world map. Search for a city, click anywhere, or use your location to see which earthquakes, major-disaster alerts, satellite thermal detections and (in the United States) weather alerts the connected sources report nearby — with every source's coverage, limitations and timestamps shown openly.

It runs entirely on **GitHub Pages**. Data is refreshed by **scheduled GitHub Actions workflows** and published as static JSON/GeoJSON. There is no backend, database, account system, analytics or tracking.

> **Disclaimer.** This website aggregates third-party public data and may be delayed, incomplete, inaccurate, or unavailable. It is not an emergency warning system and must not be used as a substitute for official local authorities, emergency services, or safety instructions.

The site never says a place is “safe”. When nothing is found it says: *“No matching incidents were detected by the connected sources for this area and selected time window.”*

---

## Contents

- [Data layers](#data-layers)
- [How it works](#how-it-works)
- [Three different timestamps](#three-different-timestamps)
- [Run locally](#run-locally)
- [Deploy to GitHub Pages](#deploy-to-github-pages)
- [How the refresh works](#how-the-refresh-works)
- [Secrets and configuration](#secrets-and-configuration)
- [Enable or disable a source](#enable-or-disable-a-source)
- [Published data format](#published-data-format)
- [Testing](#testing)
- [Known limitations](#known-limitations)
- [Adding another source safely](#adding-another-source-safely)
- [Attribution](#attribution)
- [Privacy](#privacy)
- [Project structure](#project-structure)

---

## Data layers

| Layer | Source | Coverage | Scheduled refresh (best effort) | Marked stale after |
| --- | --- | --- | --- | --- |
| Earthquakes | [USGS](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php) “all earthquakes, past 7 days” GeoJSON feed | Global | ≈ every 15 min | 45 min |
| Major disasters | [GDACS](https://www.gdacs.org/) event list (JSON SEARCH → EVENTS4APP → MAP, GeoRSS fallback) + per-event affected-area geometry | Global (major events only) | ≈ every 30 min | 90 min |
| Satellite thermal detections | [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/) VIIRS + MODIS, past 7 days | Global land | ≈ every 60 min | 180 min |
| Natural events | [NASA EONET](https://eonet.gsfc.nasa.gov/docs/v3) open events (wildfires, storms, volcanoes, floods, …) | Global (curated) | ≈ every 60 min | 180 min |
| Weather alerts | [U.S. National Weather Service](https://www.weather.gov/documentation/services-web-api) active alerts | **United States & territories only** | ≈ every 15 min | 90 min |
| Internet disruptions | *not connected* (e.g. Cloudflare Radar) | — | — | — |
| Electricity outages | *not connected* (regional provider plugins) | — | — | — |
| Airport / airspace | *not connected* (e.g. FAA NAS status) | — | — | — |
| Public-health notices | *not connected* (e.g. WHO DON) | — | — | — |

Planned layers appear in the UI as **“not connected”** so a missing layer is never mistaken for “no disruption”.

Map features:

- MapLibre GL JS 2D map, OpenFreeMap vector basemap, automatic fallback to bundled country outlines if tiles cannot load.
- Earthquakes sized and coloured by magnitude (blue < M3, yellow M3–4.9, orange M5–5.9, red M6+), small events clustered at low zoom, magnitudes labelled.
- Major disasters and natural events drawn by **hazard type**: coloured icons (flood blue, storm purple, wildfire orange, volcano red, drought gold, earthquake brown), textured affected areas (flood “pixels”, wind streaks, flames, embers, cracks, zigzags) and a soft glow where only a representative point is known. The icon ring shows the GDACS alert level as published (never an invented score). US NWS warnings get the same hazard textures (e.g. wind streaks for tornado warnings). Storm paths are dotted lines with arrows pointing in the direction of travel (from regional zoom). GDACS sends a cyclone as dozens of overlapping wind circles and a track of unordered 2-point segments; the refresh merges them into one outline and one continuous path.
- A **time-window chip** at the top of the map shows the active window (Last hour / 24 hours / 48 hours / 7 days) and changes it; the choice is remembered in this browser (first visit: 24 hours).
- Events are shown only if the source reports them active inside the selected time window (an event whose latest episode ended before the window is hidden).
- FIRMS satellite heat spots are **off on the map by default** (they are numerous and mostly not wildfires); when switched on they default to high-confidence detections, aggregated into a 1° grid at low zoom and loaded as 10° tiles when zoomed in. Location cards still report nearby high-confidence heat spots. Named wildfires come from GDACS and NASA EONET.
- NWS warning polygons / zone outlines with transparent fills. This layer is **off by default** (switch it on under Layers & filters); while it is off, the location card says so instead of listing NWS alerts.
- Filters: time window (1 h / 24 h / 48 h / 7 days), magnitude, depth, significant-only, GDACS level and hazard type, FIRMS confidence and sensor, NWS severity.
- **Location Status card** with radius (25–500 km, default 100 km), per-category results, distance and compass direction, source status, and coverage notes. Shareable via URL.
- **Emergency numbers** for the selected country (police / ambulance / fire, tap to call), compiled from Wikipedia's list of emergency telephone numbers and shown with a "confirm locally" note.
- **Installable, works offline** (PWA): the app shell, country outlines, city list and emergency numbers are cached; the latest published data seen on the device is reused offline with its real timestamps; **Save for offline** on a location card also stores the place and pre-downloads its map area. Saved places are listed under the **★ Saved** button in the top bar.
- Search: instant suggestions from a bundled city list, worldwide search via OpenStreetMap Nominatim only on submit.
- Light/dark themes, km/miles, local time/UTC, keyboard navigation, reduced-motion support, mobile bottom sheet.

## How it works

```
             ┌───────────── GitHub Actions: "Refresh data" (cron */15, best effort) ─────────────┐
 USGS  ─┐    │ restore last data from `data` branch → fetch due sources (timeouts, retries)       │
 GDACS ─┼──► │ → normalise → validate → write per-source files + metadata → manifest.json        │
 FIRMS ─┤    │   (a failed fetch keeps the last valid files and records the failure)             │
 NWS   ─┘    │ → push snapshot to `data` branch → call "Deploy to GitHub Pages"                   │
             └──────────────────────────────────────────────────────────────────────────────────┘
                                                   │
             ┌──────── "Deploy to GitHub Pages" ───▼───────────────────────────────────────────┐
             │ npm test → copy data branch into the build → vite build → deploy Pages artifact │
             └─────────────────────────────────────────────────────────────────────────────────┘
                                                   │
                         Browser loads static HTML/JS + ./data/*.json (no keys, no backend)
```

## Three different timestamps

The UI always distinguishes:

1. **Source event time** — when the event happened or the alert was issued, according to the source.
2. **Last fetched by this project** — when the refresh workflow last fetched the source successfully (`lastSuccessfulFetchUtc`).
3. **Last published update** — when the static data was generated and published to GitHub Pages (`manifest.generatedAtUtc`, plus the site build time in `publish.json`).

All JSON timestamps are UTC (ISO 8601, `Z`). The UI converts them to the viewer's time zone, with a UTC option.

## Run locally

Requires **Node.js 22.12+**.

```bash
npm install
npm run dev          # http://localhost:5173 — uses SAMPLE data (purple “Sample data” banner)
```

With no live data present, `npm run dev`/`npm run build` generate **sample fixtures** (clearly labelled `[Sample]`, `mode: "fixture"`) from `test/fixtures/sample-sources.mjs`, time-shifted to “now” so time filters behave realistically. A static copy at a fixed reference time is committed in `data/fixtures/` for inspection.

To use real data locally (needs network access to the sources):

```bash
npm run refresh:force        # fetch all sources into data/generated/
npm run dev                  # now serves live data
```

Other commands:

```bash
npm run build                # production build into dist/ (with whatever data is staged)
npm run preview              # serve dist/
npm test                     # unit tests (Vitest)
npm run test:e2e             # Playwright smoke tests (desktop + mobile, sample data)
npm run fixtures             # regenerate data/fixtures/
npm run icons                # re-render favicon.svg and the PNG app icons from assets/app-icon.svg
DATA_SOURCE=fixtures SIMULATE=gdacs-disasters=failed,nws-alerts=stale npm run dev
                             # sample data with simulated failed/stale sources (states: failed, stale, nodata)
```

## Deploy to GitHub Pages

1. Push this repository to GitHub (public repositories get free Actions minutes).
2. **Settings → Pages → Build and deployment → Source: “GitHub Actions”.**
3. **Settings → Actions → General → Workflow permissions:** leave the default; the workflows request what they need (`contents: write` only for the refresh job that pushes the `data` branch, `pages: write` + `id-token: write` for deployment).
4. Optionally add the `FIRMS_MAP_KEY` secret (see below).
5. Run **Actions → “Refresh data” → Run workflow** (tick *force*) once. It creates the `data` branch and deploys the site. Pushing to `main` also deploys; if no `data` branch exists yet, that deployment fetches live data once (“bootstrap”).

The site is then available at `https://<user>.github.io/<repo>/`. The build uses relative paths, so it works under any Pages path or a custom domain.

Production builds set `REQUIRE_LIVE_DATA=true`, so **sample fixtures can never be deployed**.

### Workflows

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `.github/workflows/refresh-data.yml` | cron `7,22,37,52 * * * *`, manual, external timer | Fetches *due* sources, writes data + metadata, pushes a snapshot to the `data` branch, then calls the deploy workflow. Skips the commit and deploy when nothing was due or the data is byte-identical. |
| `.github/workflows/deploy-pages.yml` | push to `main`, manual, called by refresh | Runs unit tests, copies the `data` branch into the build, builds with Vite, deploys to Pages. |
| `.github/workflows/ci.yml` | pull requests, other branches | Unit tests, sample-data build, checks `data/fixtures` is up to date. |

## How the refresh works

- The workflow runs on a 15-minute cron, but **each source has its own interval** in `config/sources.json`; `scripts/refresh.mjs` only fetches sources whose last attempt is older than that interval (minus 4 minutes of tolerance for cron jitter).
- **GitHub Actions scheduled workflows are not guaranteed to start on time.** They are often delayed, especially at busy times (the top of the hour is busiest), and runs can occasionally be dropped. The UI therefore never says “updated every 15 minutes exactly”; it shows the actual recorded timestamps and the wording *“Refreshes are scheduled at intervals, but actual update timing depends on source availability and GitHub Actions scheduling.”*
- Every fetch has a timeout, retries with exponential backoff for network errors / HTTP 429 / 5xx, and an identifying User-Agent (NWS requires one).
- Normalised output is validated (schema, geometry, timestamps, URLs, duplicate ids, minimum record counts). **If fetching or validation fails, the previous files are left untouched** and only the metadata records the failed attempt and error. Tiled FIRMS output is written to a staging directory and swapped in atomically.
- Output is sorted deterministically so unchanged data produces identical files.
- The `data` branch is a **rolling snapshot** (a single force-pushed commit) by default, so frequently changing generated data — FIRMS tiles in particular — never bloats the repository history. Set the repository variable `DATA_BRANCH_MODE=history` to keep every snapshot as a normal commit instead.
- The browser re-checks `manifest.json` every 10 minutes and recalculates source status from the current time, so data visibly ages into “stale” if updates stop.

### Reliable timing with an external trigger

GitHub's own schedule is best-effort and can be late or skip runs (a new schedule can also take a while to start). For dependable updates, let a free external cron service start the workflow through the GitHub API:

1. Create a **fine-grained personal access token**: GitHub → Settings → Developer settings → Personal access tokens → Fine-grained → *Generate new token*. Repository access: **only this repository**. Permissions: **Actions: Read and write** (nothing else). Set an expiry and note it.
2. On [cron-job.org](https://cron-job.org) (free), create a job:
   - URL: `https://api.github.com/repos/<owner>/<repo>/actions/workflows/refresh-data.yml/dispatches`
   - Method: **POST**, schedule **every 10 or 15 minutes**
   - Headers: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `Content-Type: application/json`
   - Body: `{"ref":"main"}`
3. A successful call returns **HTTP 204**; the run appears under Actions as *workflow_dispatch*.

Triggering often is safe for the data sources: each run only fetches sources that are *due* (USGS and NWS ≈ 15 min, GDACS ≈ 30 min, FIRMS and EONET ≈ 60 min), and a run with nothing due exits without committing or deploying. Overlapping triggers queue behind the running one (only one waits). The token can only start this repository's workflows; keep it private and renew it before it expires.

Things to know about GitHub Actions:

- In public repositories, **scheduled workflows are automatically disabled after 60 days without repository activity**. Re-enable them from the Actions tab (or push a commit) if updates stop.
- In private repositories, a 15-minute schedule uses roughly 3,000–6,000 Actions minutes per month, which exceeds the free allowance on most plans. Reduce the cron frequency if needed.

## Secrets and configuration

> ⚠️ **Never put API keys or tokens in frontend code, `config/sources.json`, or any file that is published.** Keys exist only as GitHub Actions secrets, are read by the refresh scripts inside the workflow, and are redacted from logs and error messages. The browser only ever receives the normalised output.

**Secrets** (Settings → Secrets and variables → Actions → *Secrets*):

| Secret | Required | Purpose |
| --- | --- | --- |
| `FIRMS_MAP_KEY` | No | NASA FIRMS [MAP_KEY](https://firms.modaps.eosdis.nasa.gov/api/map_key/). If set, the FIRMS area API is used; otherwise the public FIRMS 7-day active-fire text files are downloaded. |

**Variables** (same page, *Variables* tab), all optional:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DISABLED_SOURCES` | — | Comma-separated source keys to stop fetching, e.g. `nws-alerts`. |
| `FIRMS_PRODUCTS` | `VIIRS_NOAA20_NRT,MODIS_NRT` | FIRMS products (`VIIRS_NOAA20_NRT`, `VIIRS_NOAA21_NRT`, `VIIRS_SNPP_NRT`, `MODIS_NRT`). |
| `FIRMS_MAX_DETECTIONS` | `300000` | Cap on published detections; lowest-confidence/oldest are dropped first and the cap is disclosed in the metadata. |
| `NWS_USER_AGENT` | `(GlobalIncidentMap, https://github.com/<repo>)` | User-Agent sent to api.weather.gov. NWS asks for contact information — e.g. `(my-incident-map, me@example.com)`. |
| `DATA_USER_AGENT` | `GlobalIncidentMap/1.0 (+https://github.com/<repo>)` | User-Agent for other sources. |
| `DATA_BRANCH_MODE` | `snapshot` | `history` keeps every data snapshot as a commit. |

## Enable or disable a source

- **Temporarily:** add its key to the `DISABLED_SOURCES` repository variable.
- **Permanently:** set `"enabled": false` in `config/sources.json`.

A disabled source stays listed in the manifest with status `unavailable`, and the UI shows it as not connected rather than silently hiding it.

## Published data format

Everything below is served from `./data/` on the site and lives on the `data` branch.

```
manifest.json                    overall manifest (generatedAtUtc, sources[], statuses, run URL, app version)
publish.json                     when this static build was published (≈ GitHub Pages publish time)
sources/<key>.json               per-source metadata (status, timestamps, error, notes, attribution, coverage)
incidents/<key>.json             normalised incidents (GeoJSON FeatureCollection)
fires/index.json                 FIRMS tile index, sensors, field order, totals
fires/summary.json               FIRMS 1° summary grid (counts by sensor / confidence / age)
fires/tiles/<x>_<y>.json         FIRMS 10° × 10° tiles of detection rows
cache/nws-zones.json             (data branch only) simplified NWS zone outlines, not deployed
```

**Per-source metadata** (`sources/<key>.json`, also embedded in `manifest.sources`):

| Field | Meaning |
| --- | --- |
| `source`, `sourceKey`, `sourceUrl`, `homepageUrl`, `docsUrl` | Source name, key and official links (`source_name`, `source_url`) |
| `status` | `ok` / `stale` / `failed` / `unavailable` at generation time (the browser recomputes it with the current time) |
| `lastSuccessfulFetchUtc` | Last successful fetch by this project (`project_last_successful_fetch_utc`) |
| `lastAttemptUtc`, `lastAttemptOk` | Last attempt and whether it succeeded (`project_last_attempt_utc`) |
| `sourceLatestDataTimeUtc` | The source's own feed/update time when supplied |
| `sourceLastEventTimeUtc` | Newest event time in the data (`source_last_event_time`) |
| `scheduleDescription`, `refreshIntervalMinutes` | Best-effort schedule (`project_next_scheduled_refresh_description`) |
| `staleAfterMinutes` | Stale threshold (`stale_after_minutes`) |
| `workflowRunUrl` | GitHub Actions run that produced the metadata |
| `error` | Last error message — shown only on the sources page diagnostics (`source_error_message`) |
| `licenseOrAttribution`, `coverage`, `coverageLimitations` | Attribution/licence and coverage notes |
| `recordsPublished`, `notes`, `consecutiveFailures` | Diagnostics |

**Status rules** (`src/shared/status.js`, shared by scripts and browser):

- `ok` — last successful fetch within `staleAfterMinutes`.
- `stale` — no successful fetch within the threshold, and the last attempt did not fail (e.g. delayed schedule).
- `failed` — the last attempt failed and there is no recent valid data (old data, if any, is still shown with its time).
- `unavailable` — disabled, not implemented, or (in the location card) outside a regional source's coverage.

**Incident schema** (`properties` of each GeoJSON Feature, see `src/shared/schema.js`):

```json
{
  "id": "usgs:us7000abcd",
  "source": "USGS",
  "sourceKey": "usgs-earthquakes",
  "sourceUrl": "https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd",
  "category": "earthquake",
  "subtype": "earthquake",
  "title": "M 5.2 - 45 km SE of …",
  "summary": "Magnitude 5.2 (mww) earthquake at 10 km depth",
  "severity": { "label": "M 5.2", "numeric": 5.2, "sourceLevel": null, "colorHint": "orange" },
  "affectedGeometry": null,
  "locationPrecision": "exact",
  "eventStartUtc": "2026-01-01T00:00:00Z",
  "eventEndUtc": null,
  "sourceUpdatedUtc": "2026-01-01T00:10:00Z",
  "fetchedUtc": "2026-01-01T00:15:00Z",
  "countryCodes": [],
  "regionText": "…",
  "attributes": { "depthKm": 10, "tsunami": false, "pagerAlert": null, "significant": false },
  "disclaimer": null,
  "attribution": "USGS",
  "status": "active"
}
```

`locationPrecision` is `exact`, `representative` (a single coordinate for a broader event), `area` (published polygon) or `zone` (NWS zone outlines). The Feature `geometry` is the event point (or alert polygon for NWS).

FIRMS detections use a compact row format to keep files small: `[lon, lat, minutesSinceEpoch, sensorIndex, confidence(0 low / 1 nominal / 2 high), frp, brightness, dayNight(0 day / 1 night)]`.

## Testing

```bash
npm test          # 80+ unit tests
npm run test:e2e  # Playwright smoke tests; PLAYWRIGHT_CHROMIUM_PATH=/path/to/chromium to use a local browser
```

Unit tests cover Haversine distance, compass direction, time formatting, stale-status calculation, normalisation of every source (including the GDACS RSS fallback), schema validation, radius/containment filtering, the location report (city near an earthquake, city with nothing nearby, thermal-detection area, US location inside an NWS alert, unsupported power/Internet coverage, stale and failed sources), **preservation of the last valid data when a fetch fails or returns empty/invalid data**, URL state, local search, fixture validity, and a guard against “safe” / “real-time” wording in the UI.

Manual test steps are in [`docs/TESTING.md`](docs/TESTING.md).

## Known limitations

- **Emergency numbers are community-compiled** (from Wikipedia) and can be wrong or out of date; the card says to confirm locally.
- **Offline mode shows only what this device has already downloaded**; it never updates until you reconnect. Map areas you have not viewed or saved show the simplified country outlines.

- **Not an emergency warning system.** Data can be delayed, incomplete, revised, or unavailable. Always follow official authorities.
- **No real-time guarantee.** Data reflects the last published update. GitHub Actions scheduled jobs can be delayed or skipped.
- **Satellite hotspots are not confirmed wildfires.** FIRMS detections include agricultural burning, industrial heat sources, gas flares and other thermal anomalies; clouds and overpass timing cause gaps.
- **No universal global blackout feed** exists; electricity outages need per-provider integrations and none is connected.
- **Internet-outage data** (e.g. Cloudflare Radar) needs a secured token, licence review, and has country/network-level rather than city-level precision. Not connected.
- **NWS covers only the United States and territories**; zone-based alerts are drawn with simplified outlines, and alerts whose zone outlines have not been fetched yet are counted in the source notes.
- **GDACS** lists only major events; alert levels are model estimates that change; many events have only a representative coordinate.
- **USGS** completeness varies by region; small events outside the US may be missing; parameters are revised.
- Clicked-point country detection uses 1:50m Natural Earth outlines and is approximate near borders and coasts.
- The FIRMS overview grid counts are approximate (age buckets are relative to generation time).

## Adding another source safely

1. **Check the terms first**: licence, attribution, permitted automated access, caching and redistribution, rate limits. Do not scrape sites that prohibit it. Prefer official structured feeds (GeoJSON, CAP, CSV, documented APIs).
2. **Add an entry to `config/sources.json`** with honest `coverage`, `coverageLimitations`, `geometryLevel`, `scope` (`global` / `regional` / `experimental`), `regionCountryCodes` for regional sources, `refreshIntervalMinutes`, `staleAfterMinutes`, `scheduleDescription` and `licenseOrAttribution`.
3. **Write an adapter** in `scripts/sources/<name>.mjs` exporting `key`, `fetchRaw(ctx)` (network only) and `normalize(raw, ctx)` (pure). Return `{ files, records, minExpectedRecords, sourceLatestDataTimeUtc, notes }`; build incidents with `makeIncident()` from `src/shared/schema.js`. Register it in `scripts/sources/index.mjs`.
4. **Keep credentials server-side**: read keys from `process.env` inside the adapter, call `registerSecret()` so they are redacted, and add them to the workflow `env:` from `secrets.*`. Never publish raw responses that might contain keys.
5. **Preserve the source's own classification** (severity, urgency, certainty, alert level). Do not invent scores; do not turn country- or region-level alerts into precise city pins (`locationPrecision: 'representative'` or polygons).
6. **Add a sample payload** to `test/fixtures/sample-sources.mjs`, normaliser tests, and run `npm run fixtures`.
7. **Wire the category into the UI** (`src/lib/relevance.js` category list, layer in `src/map/controller.js`, panel entry) and make sure unsupported locations show “Coverage unavailable” or “No … source is currently connected for this location”, never an all-clear.

For electricity outages specifically, each provider plugin should declare its official name, coverage polygon/region, official URL, data type, expected refresh interval, and limitations; the location card must only use a provider whose coverage contains the selected point.

## Attribution

- Earthquakes: U.S. Geological Survey (USGS), Earthquake Hazards Program.
- Disaster alerts: GDACS — Global Disaster Alert and Coordination System (European Commission Joint Research Centre and UN OCHA).
- Thermal detections: NASA FIRMS (LANCE).
- Weather alerts: NOAA / U.S. National Weather Service.
- Basemap: [OpenFreeMap](https://openfreemap.org/) — © OpenMapTiles, data © OpenStreetMap contributors.
- Geocoding: OpenStreetMap Nominatim (used within its [usage policy](https://operations.osmfoundation.org/policies/nominatim/): no autocomplete, explicit submit only, ≤ 1 request/second, cached).
- Country outlines: Natural Earth via `world-atlas`. City list: GeoNames (CC BY 4.0) via `all-the-cities`.
- Natural events: NASA Earth Observatory Natural Event Tracker (EONET), linking to each event's original source.
- Emergency numbers: Wikipedia, "List of emergency telephone numbers" (CC BY-SA 4.0), via the `emergency-numbers` and `emergency-and-helplines` packages. Community-compiled — not verified official data.
- Map rendering: MapLibre GL JS (BSD-3-Clause).

This project is not affiliated with or endorsed by any of these organisations.

## Privacy

- No accounts, analytics, ads or tracking. No server receives your location or searches.
- Browser geolocation is opt-in and used only in your browser.
- Settings and saved places are stored only in `localStorage`; offline copies (app, data, viewed map tiles) are kept in the browser's Cache Storage by the service worker. Clearing site data removes them.
- Third parties: OpenFreeMap receives tile requests needed to draw the map; Nominatim receives the text of searches you explicitly submit. Typing suggestions and clicked-point labels are computed locally.

## Project structure

```
index.html, sources.html, methodology.html, about.html   pages (Vite multi-page build)
config/sources.json            source registry (shared by scripts and UI via the manifest)
scripts/
  refresh.mjs                  fetch due sources → data/generated (used by the workflow)
  sources/{usgs,gdacs,firms,nws,eonet}.mjs   source adapters (fetchRaw + normalize)
  lib/pipeline.js              validate, write, preserve-last-valid, metadata, manifest
  lib/http.js                  timeouts, retries, User-Agent, secret redaction
  build-fixtures.mjs           sample data through the real normalisers
  stage-data.mjs               copy live data (or generate samples) into public/data
  build-geo-assets.mjs         bundled country outlines, city index, emergency numbers → public/geo
  build-sw.mjs                 service worker for offline use (runs after vite build)
src/
  shared/                      pure modules used by both Node and browser (geo, time, status, schema, FIRMS codec)
  lib/                         browser logic (filters, relevance, data loading, geocoding, URL state, prefs)
  map/                         MapLibre controller, layers, icons
  ui/                          panel, location card, popups, status strip, search, list
  pages/                       sources page + shared page bootstrap
  styles/main.css              design system (light/dark tokens, responsive layout)
data/fixtures/                 committed sample output at a fixed reference time
test/                          Vitest unit tests, sample payloads, Playwright e2e
.github/workflows/             refresh-data, deploy-pages, ci
```

No licence has been chosen for this repository yet; add a `LICENSE` file before inviting reuse. Data remains subject to each source's own terms.
