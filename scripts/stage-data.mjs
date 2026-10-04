#!/usr/bin/env node
// Copy data into public/data so Vite serves (dev) or bundles (build) it.
//
// * If data/generated/manifest.json exists (written by scripts/refresh.mjs or
//   checked out from the `data` branch in CI), that live data is staged.
// * Otherwise SAMPLE data is generated with the current time, so local
//   development works offline. The manifest is flagged mode: "fixture" and the
//   UI displays a "sample data" banner.
//
// Env: DATA_SOURCE=fixtures forces sample data; SIMULATE=key=state,... passes
// --simulate through to the fixture builder (for manual testing of stale states).
// In CI set REQUIRE_LIVE_DATA=true so sample data can never be deployed.

import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './lib/config.js';
import { exists, writeJson } from './lib/io.js';
import { buildFixtures } from './build-fixtures.mjs';
import { toIsoUtc } from '../src/shared/time.js';

const target = path.join(ROOT, 'public/data');
const generated = path.join(ROOT, 'data/generated');
const useLive = process.env.DATA_SOURCE !== 'fixtures' && (await exists(path.join(generated, 'manifest.json')));

await fs.rm(target, { recursive: true, force: true });
let mode;
if (useLive) {
  await fs.cp(generated, target, {
    recursive: true,
    filter: (src) => !src.includes(`${path.sep}cache`) && !src.includes('.git') && !/\.tmp-|\.staging-|\.old-/.test(src),
  });
  mode = 'live';
  console.log('Staged live data from data/generated → public/data');
} else {
  if (process.env.REQUIRE_LIVE_DATA === 'true') {
    console.error('REQUIRE_LIVE_DATA is set but data/generated/manifest.json does not exist. Refusing to publish sample data.');
    process.exit(1);
  }
  const simulate = Object.fromEntries((process.env.SIMULATE || '').split(',').filter(Boolean).map((s) => s.split('=')));
  await buildFixtures({ outDir: target, now: Date.now(), simulate, quiet: true });
  mode = 'fixture';
  console.log('No live data found — generated SAMPLE data in public/data (shown with a demo banner).');
}

// Publication record: when this static build was produced (≈ GitHub Pages publish time).
await writeJson(
  path.join(target, 'publish.json'),
  {
    publishedAtUtc: toIsoUtc(Date.now()),
    commitSha: process.env.GITHUB_SHA || null,
    workflowRunUrl: process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null,
    dataMode: mode,
  },
  { pretty: true },
);
