#!/usr/bin/env node
// Refresh public data sources and rebuild the manifest.
//
//   node scripts/refresh.mjs                 # refresh sources that are due
//   node scripts/refresh.mjs --force         # refresh every enabled source now
//   node scripts/refresh.mjs --source usgs-earthquakes,nws-alerts
//   node scripts/refresh.mjs --data-dir data/generated
//
// Exit code is 0 even when individual sources fail (their status is recorded);
// it is non-zero only for unexpected errors in the pipeline itself.

import path from 'node:path';
import { adapters } from './sources/index.mjs';
import { ROOT, appVersion, loadSourceConfigs } from './lib/config.js';
import { buildManifest, isDue, refreshSource } from './lib/pipeline.js';
import { readJson } from './lib/io.js';

function parseArgs(argv) {
  const args = { force: false, sources: null, dataDir: path.join(ROOT, 'data/generated') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') args.force = true;
    else if (a === '--source') args.sources = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--data-dir') args.dataDir = path.resolve(argv[++i]);
  }
  if (process.env.REFRESH_FORCE === 'true') args.force = true;
  if (!args.sources && process.env.REFRESH_SOURCES) args.sources = process.env.REFRESH_SOURCES.split(',').map((s) => s.trim()).filter(Boolean);
  return args;
}

const args = parseArgs(process.argv.slice(2));
const configs = await loadSourceConfigs();
const now = Date.now();
let refreshed = 0;

for (const config of configs) {
  if (config.enabled === false || config.implemented === false) continue;
  if (args.sources && !args.sources.includes(config.key)) continue;
  const adapter = adapters[config.key];
  if (!adapter) {
    console.warn(`! ${config.key}: no adapter registered; skipping`);
    continue;
  }
  const prev = await readJson(path.join(args.dataDir, 'sources', `${config.key}.json`));
  const forced = args.force || Boolean(args.sources);
  if (!isDue(prev, config, now, { force: forced })) {
    console.log(`· ${config.key}: not due (last attempt ${prev?.lastAttemptUtc})`);
    continue;
  }
  console.log(`→ ${config.key}`);
  await refreshSource({ config, adapter, dataDir: args.dataDir, now: Date.now() });
  refreshed++;
}

const manifest = await buildManifest({ dataDir: args.dataDir, configs, now: Date.now(), mode: 'live', appVersion: await appVersion() });
console.log(`\nRefreshed ${refreshed} source(s). Manifest generated at ${manifest.generatedAtUtc}.`);
for (const s of manifest.sources) console.log(`  ${s.status.padEnd(11)} ${s.sourceKey}${s.error ? ` — ${s.error}` : ''}`);

// Let the workflow know whether anything was attempted.
if (process.env.GITHUB_OUTPUT) {
  const fs = await import('node:fs/promises');
  await fs.appendFile(process.env.GITHUB_OUTPUT, `refreshed=${refreshed}\n`);
}
