#!/usr/bin/env node
// Build SAMPLE data by running the real normalisers over deterministic sample
// payloads (test/fixtures/sample-sources.mjs). No network access is used.
//
//   node scripts/build-fixtures.mjs                       # → data/fixtures at a fixed reference time
//   node scripts/build-fixtures.mjs --now now --out public/data
//   node scripts/build-fixtures.mjs --simulate gdacs-disasters=failed,firms-hotspots=stale
//
// --simulate states: failed (latest attempt failed, data older than threshold),
// stale (no recent run), nodata (never fetched successfully).

import fs from 'node:fs/promises';
import path from 'node:path';
import { adapters } from './sources/index.mjs';
import { ROOT, appVersion, loadSourceConfigs } from './lib/config.js';
import { buildManifest, refreshSource } from './lib/pipeline.js';
import { readJson, writeJson } from './lib/io.js';
import { computeSourceStatus } from '../src/shared/status.js';
import { toIsoUtc } from '../src/shared/time.js';
import { SAMPLE_BUILDERS } from '../test/fixtures/sample-sources.mjs';

export const FIXTURE_REFERENCE_TIME = '2026-10-04T12:00:00Z';

export async function buildFixtures({ outDir, now, simulate = {}, quiet = false }) {
  const configs = await loadSourceConfigs();
  await fs.rm(outDir, { recursive: true, force: true });
  const log = quiet ? () => {} : console.log;
  for (const config of configs) {
    const build = SAMPLE_BUILDERS[config.key];
    if (!build || config.enabled === false) continue;
    await refreshSource({ config, adapter: adapters[config.key], dataDir: outDir, now, rawOverride: build(now), log, runUrl: null });
    const state = simulate[config.key];
    if (state) {
      const metaPath = path.join(outDir, 'sources', `${config.key}.json`);
      const meta = await readJson(metaPath);
      const old = toIsoUtc(now - (config.staleAfterMinutes + 45) * 60_000);
      if (state === 'failed') Object.assign(meta, { lastAttemptUtc: toIsoUtc(now), lastAttemptOk: false, lastSuccessfulFetchUtc: old, error: 'Simulated failure: HTTP 503 Service Unavailable', consecutiveFailures: 4 });
      if (state === 'stale') Object.assign(meta, { lastAttemptUtc: old, lastAttemptOk: true, lastSuccessfulFetchUtc: old });
      if (state === 'nodata') {
        Object.assign(meta, { lastAttemptUtc: toIsoUtc(now), lastAttemptOk: false, lastSuccessfulFetchUtc: null, recordsPublished: 0, error: 'Simulated failure: no data has ever been fetched' });
        for (const f of meta.dataFiles) await fs.rm(path.join(outDir, f), { force: true });
        if (config.key === 'firms-hotspots') await fs.rm(path.join(outDir, 'fires'), { recursive: true, force: true });
        meta.dataFiles = [];
      }
      meta.status = computeSourceStatus(meta, now);
      await writeJson(metaPath, meta, { pretty: true });
      log(`  simulated ${state} for ${config.key}`);
    }
  }
  await fs.rm(path.join(outDir, 'cache'), { recursive: true, force: true });
  return buildManifest({ dataDir: outDir, configs, now, mode: 'fixture', appVersion: await appVersion(), env: {} });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const get = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? null : args[i + 1];
  };
  const nowArg = get('--now') || FIXTURE_REFERENCE_TIME;
  const now = nowArg === 'now' ? Date.now() : Date.parse(nowArg);
  const outDir = path.resolve(get('--out') || path.join(ROOT, 'data/fixtures'));
  const simulate = Object.fromEntries((get('--simulate') || '').split(',').filter(Boolean).map((s) => s.split('=')));
  const manifest = await buildFixtures({ outDir, now, simulate });
  console.log(`Sample data written to ${path.relative(ROOT, outDir)} (reference time ${manifest.generatedAtUtc}).`);
}
