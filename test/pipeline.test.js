import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildManifest, isDue, refreshSource, validateOutput } from '../scripts/lib/pipeline.js';
import { redact, registerSecret } from '../scripts/lib/http.js';
import * as usgs from '../scripts/sources/usgs.mjs';
import * as firms from '../scripts/sources/firms.mjs';
import { sampleFirms, sampleUsgs } from './fixtures/sample-sources.mjs';

const T0 = Date.parse('2026-10-04T12:00:00Z');
const config = { key: 'usgs-earthquakes', name: 'USGS', shortName: 'USGS', category: 'earthquake', refreshIntervalMinutes: 15, staleAfterMinutes: 45, enabled: true, implemented: true };
const firmsConfig = { ...config, key: 'firms-hotspots', refreshIntervalMinutes: 60, staleAfterMinutes: 180 };
const quiet = () => {};
let dir;

const readJson = async (rel) => JSON.parse(await fs.readFile(path.join(dir, rel), 'utf8'));
const failing = (message) => ({ ...usgs, fetchRaw: async () => { throw new Error(message); } });

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gim-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('refreshSource', () => {
  it('writes incidents and ok metadata on success', async () => {
    const meta = await refreshSource({ config, adapter: usgs, dataDir: dir, now: T0, rawOverride: sampleUsgs(T0), log: quiet, runUrl: 'https://github.com/o/r/actions/runs/1' });
    expect(meta).toMatchObject({ status: 'ok', lastAttemptOk: true, lastSuccessfulFetchUtc: '2026-10-04T12:00:00Z', error: null, workflowRunUrl: 'https://github.com/o/r/actions/runs/1' });
    const fc = await readJson('incidents/usgs-earthquakes.json');
    expect(fc.features.length).toBe(meta.recordsPublished);
    expect(await readJson('sources/usgs-earthquakes.json')).toEqual(meta);
  });

  it('preserves the last valid data when a later fetch fails', async () => {
    await refreshSource({ config, adapter: usgs, dataDir: dir, now: T0, rawOverride: sampleUsgs(T0), log: quiet });
    const before = await fs.readFile(path.join(dir, 'incidents/usgs-earthquakes.json'), 'utf8');
    const t1 = T0 + 20 * 60_000;
    const meta = await refreshSource({ config, adapter: failing('HTTP 503 Service Unavailable'), dataDir: dir, now: t1, log: quiet });
    expect(await fs.readFile(path.join(dir, 'incidents/usgs-earthquakes.json'), 'utf8')).toBe(before);
    expect(meta).toMatchObject({
      lastAttemptOk: false,
      lastAttemptUtc: '2026-10-04T12:20:00Z',
      lastSuccessfulFetchUtc: '2026-10-04T12:00:00Z',
      error: 'HTTP 503 Service Unavailable',
      consecutiveFailures: 1,
      status: 'ok', // data still within the 45-minute threshold
    });
    const later = await refreshSource({ config, adapter: failing('timeout'), dataDir: dir, now: T0 + 90 * 60_000, log: quiet });
    expect(later.status).toBe('failed');
    expect(later.consecutiveFailures).toBe(2);
    expect(later.recordsPublished).toBe(JSON.parse(before).features.length);
  });

  it('never replaces valid data with an empty or invalid response', async () => {
    await refreshSource({ config, adapter: usgs, dataDir: dir, now: T0, rawOverride: sampleUsgs(T0), log: quiet });
    const before = await fs.readFile(path.join(dir, 'incidents/usgs-earthquakes.json'), 'utf8');
    const empty = await refreshSource({ config, adapter: usgs, dataDir: dir, now: T0 + 60_000, rawOverride: { type: 'FeatureCollection', features: [] }, log: quiet });
    expect(empty.lastAttemptOk).toBe(false);
    expect(empty.error).toMatch(/expected at least 1/);
    const bad = await refreshSource({ config, adapter: usgs, dataDir: dir, now: T0 + 120_000, rawOverride: '<html>error</html>', log: quiet });
    expect(bad.lastAttemptOk).toBe(false);
    expect(await fs.readFile(path.join(dir, 'incidents/usgs-earthquakes.json'), 'utf8')).toBe(before);
  });

  it('records failure with no data when a source has never succeeded', async () => {
    const meta = await refreshSource({ config, adapter: failing('DNS failure'), dataDir: dir, now: T0, log: quiet });
    expect(meta).toMatchObject({ status: 'failed', lastSuccessfulFetchUtc: null, recordsPublished: 0 });
    await expect(fs.access(path.join(dir, 'incidents/usgs-earthquakes.json'))).rejects.toThrow();
  });

  it('swaps tiled output atomically and removes stale tiles', async () => {
    await refreshSource({ config: firmsConfig, adapter: firms, dataDir: dir, now: T0, rawOverride: sampleFirms(T0), log: quiet });
    await fs.writeFile(path.join(dir, 'fires/tiles/99_99.json'), '{}');
    await refreshSource({ config: firmsConfig, adapter: firms, dataDir: dir, now: T0 + 3_600_000, rawOverride: sampleFirms(T0 + 3_600_000), log: quiet });
    const tiles = await fs.readdir(path.join(dir, 'fires/tiles'));
    expect(tiles).not.toContain('99_99.json');
    expect((await fs.readdir(path.join(dir, 'fires'))).filter((f) => f.includes('staging') || f.includes('.old-'))).toEqual([]);
    // A failed FIRMS fetch keeps the existing tiles.
    await refreshSource({ config: firmsConfig, adapter: { ...firms, fetchRaw: async () => { throw new Error('x'); } }, dataDir: dir, now: T0 + 7_200_000, log: quiet });
    expect((await fs.readdir(path.join(dir, 'fires/tiles'))).length).toBe(tiles.length);
  });
});

describe('scheduling and manifest', () => {
  it('decides whether a source is due with tolerance for cron jitter', () => {
    expect(isDue(null, config, T0)).toBe(true);
    expect(isDue({ lastAttemptUtc: '2026-10-04T11:50:00Z' }, config, T0)).toBe(false);
    expect(isDue({ lastAttemptUtc: '2026-10-04T11:49:00Z' }, config, T0)).toBe(true); // 11 min ≥ 15 − 4
    expect(isDue({ lastAttemptUtc: '2026-10-04T11:59:00Z' }, config, T0, { force: true })).toBe(true);
  });

  it('lists unavailable layers and recomputes status at build time', async () => {
    await refreshSource({ config, adapter: usgs, dataDir: dir, now: T0, rawOverride: sampleUsgs(T0), log: quiet });
    const future = { key: 'power-outages', name: 'Power', enabled: false, implemented: false, staleAfterMinutes: 60 };
    const neverRun = { ...config, key: 'gdacs-disasters' };
    const m = await buildManifest({ dataDir: dir, configs: [config, neverRun, future], now: T0 + 60 * 60_000, appVersion: '1.2.3', env: { GITHUB_SHA: 'abc' } });
    expect(m.sources.map((s) => [s.sourceKey, s.status])).toEqual([
      ['usgs-earthquakes', 'stale'],
      ['gdacs-disasters', 'failed'],
      ['power-outages', 'unavailable'],
    ]);
    expect(m).toMatchObject({ appVersion: '1.2.3', buildCommitSha: 'abc', generatedAtUtc: '2026-10-04T13:00:00Z' });
  });

  it('rejects unsafe output paths', () => {
    expect(() => validateOutput({ records: 0, files: { '../evil.json': {} } })).toThrow(/unsafe/);
  });
});

describe('secret redaction', () => {
  it('removes registered secrets from messages', () => {
    registerSecret('SUPERSECRETKEY123');
    expect(redact('GET https://x/api/SUPERSECRETKEY123/VIIRS failed')).toBe('GET https://x/api/***/VIIRS failed');
  });
});
