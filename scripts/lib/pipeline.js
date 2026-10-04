// Core refresh pipeline: fetch → normalise → validate → write, with per-source
// metadata. A failed fetch or failed validation NEVER overwrites the last valid
// data files; it only records the failed attempt in the source metadata.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fetchJson, fetchText, redact } from './http.js';
import { readJson, replaceDir, writeJson } from './io.js';
import { validateIncidentCollection } from '../../src/shared/schema.js';
import { computeSourceStatus } from '../../src/shared/status.js';
import { parseUtc, toIsoUtc } from '../../src/shared/time.js';

/** Minutes of slack when deciding whether a source is due (cron jitter). */
export const DUE_TOLERANCE_MINUTES = 4;

const PUBLIC_CONFIG_FIELDS = [
  'key',
  'name',
  'shortName',
  'category',
  'categoryLabel',
  'enabled',
  'implemented',
  'experimental',
  'scope',
  'geometryLevel',
  'regionCountryCodes',
  'sourceUrl',
  'homepageUrl',
  'docsUrl',
  'refreshIntervalMinutes',
  'staleAfterMinutes',
  'scheduleDescription',
  'provides',
  'coverage',
  'coverageLimitations',
  'licenseOrAttribution',
  'unavailableMessage',
  'requiresSecret',
];

/** Static, public description of a source taken from config/sources.json. */
export function metaBase(config) {
  const base = { source: config.name, sourceKey: config.key };
  for (const f of PUBLIC_CONFIG_FIELDS) if (config[f] !== undefined) base[f] = config[f];
  base.enabled = config.enabled !== false;
  base.implemented = config.implemented !== false;
  return base;
}

export function workflowRunUrl(env = process.env) {
  if (!env.GITHUB_RUN_ID || !env.GITHUB_REPOSITORY) return null;
  return `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
}

/** A source is due when its last attempt is older than its interval (minus tolerance). */
export function isDue(prevMeta, config, now, { force = false } = {}) {
  if (force) return true;
  const last = parseUtc(prevMeta?.lastAttemptUtc);
  if (last == null) return true;
  const intervalMs = (config.refreshIntervalMinutes - DUE_TOLERANCE_MINUTES) * 60_000;
  return now - last >= intervalMs;
}

/** Validate an adapter's output before anything is written. Throws on problems. */
export function validateOutput(out) {
  if (!out || typeof out.files !== 'object') throw new Error('normaliser returned no files');
  if (!Number.isFinite(out.records)) throw new Error('normaliser returned no record count');
  if (out.records < (out.minExpectedRecords ?? 0)) {
    throw new Error(
      `source returned ${out.records} records (expected at least ${out.minExpectedRecords}); keeping previous data`,
    );
  }
  for (const [rel, data] of Object.entries(out.files)) {
    if (rel.includes('..') || path.isAbsolute(rel)) throw new Error(`unsafe output path ${rel}`);
    if (rel.startsWith('incidents/')) {
      const { valid, errors } = validateIncidentCollection(data);
      if (!valid) throw new Error(`validation failed for ${rel}: ${errors.slice(0, 5).join('; ')}`);
    }
    if (rel.startsWith('fires/tiles/')) {
      if (!Array.isArray(data.rows) || data.rows.some((r) => !Array.isArray(r) || !Number.isFinite(r[0]) || !Number.isFinite(r[1]))) {
        throw new Error(`validation failed for ${rel}: malformed rows`);
      }
    }
  }
}

async function writeOutputs(dataDir, out) {
  const replaceDirs = out.replaceDirs || [];
  const staged = new Map(replaceDirs.map((d) => [d, path.join(dataDir, `${d}.staging-${process.pid}`)]));
  try {
    for (const [rel, data] of Object.entries(out.files)) {
      const dir = replaceDirs.find((d) => rel.startsWith(`${d}/`));
      const target = dir ? path.join(staged.get(dir), rel.slice(dir.length + 1)) : path.join(dataDir, rel);
      await writeJson(target, data);
    }
    for (const [dir, tmp] of staged) {
      await fs.mkdir(tmp, { recursive: true });
      await replaceDir(tmp, path.join(dataDir, dir));
    }
  } catch (e) {
    for (const tmp of staged.values()) await fs.rm(tmp, { recursive: true, force: true });
    throw e;
  }
}

/**
 * Refresh one source. `rawOverride` skips the network (used for fixtures/tests).
 * Returns the source metadata that was written.
 */
export async function refreshSource({
  config,
  adapter,
  dataDir,
  now = Date.now(),
  rawOverride,
  log = console.log,
  runUrl = workflowRunUrl(),
}) {
  const metaPath = path.join(dataDir, 'sources', `${config.key}.json`);
  const prev = await readJson(metaPath);
  const nowIso = toIsoUtc(now);
  const ctx = {
    now,
    nowIso,
    log,
    fetchText: (url, o) => fetchText(url, { log, ...o }),
    fetchJson: (url, o) => fetchJson(url, { log, ...o }),
    readPrevious: (rel) => readJson(path.join(dataDir, rel)),
  };
  let meta;
  const started = Date.now();
  try {
    const raw = rawOverride !== undefined ? rawOverride : await adapter.fetchRaw(ctx);
    const out = adapter.normalize(raw, ctx);
    validateOutput(out);
    await writeOutputs(dataDir, out);
    meta = {
      ...metaBase(config),
      lastAttemptUtc: nowIso,
      lastAttemptOk: true,
      lastSuccessfulFetchUtc: nowIso,
      sourceLatestDataTimeUtc: out.sourceLatestDataTimeUtc ?? null,
      sourceLastEventTimeUtc: out.sourceLastEventTimeUtc ?? null,
      recordsPublished: out.records,
      dataFiles: Object.keys(out.files)
        .filter((f) => !f.startsWith('cache/') && !f.startsWith('fires/tiles/'))
        .sort(),
      notes: out.notes ?? null,
      error: null,
      consecutiveFailures: 0,
      workflowRunUrl: runUrl,
      ...(out.extraMeta || {}),
    };
    log(`✔ ${config.key}: ${out.records} records (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (e) {
    const message = redact(e?.message || String(e));
    meta = {
      ...metaBase(config),
      lastAttemptUtc: nowIso,
      lastAttemptOk: false,
      lastSuccessfulFetchUtc: prev?.lastSuccessfulFetchUtc ?? null,
      sourceLatestDataTimeUtc: prev?.sourceLatestDataTimeUtc ?? null,
      sourceLastEventTimeUtc: prev?.sourceLastEventTimeUtc ?? null,
      recordsPublished: prev?.recordsPublished ?? 0,
      dataFiles: prev?.dataFiles ?? [],
      notes: prev?.notes ?? null,
      error: message,
      consecutiveFailures: (prev?.consecutiveFailures ?? 0) + 1,
      workflowRunUrl: runUrl,
    };
    log(`✖ ${config.key}: ${message} — previous data (if any) kept`);
  }
  meta.status = computeSourceStatus(meta, now);
  await writeJson(metaPath, meta, { pretty: true });
  return meta;
}

/** Metadata for a source that is disabled or not implemented. */
export function unavailableMeta(config) {
  return {
    ...metaBase(config),
    status: 'unavailable',
    lastAttemptUtc: null,
    lastAttemptOk: null,
    lastSuccessfulFetchUtc: null,
    sourceLatestDataTimeUtc: null,
    recordsPublished: 0,
    dataFiles: [],
    error: null,
  };
}

/** Build data/generated/manifest.json from all source metadata files. */
export async function buildManifest({ dataDir, configs, now = Date.now(), mode = 'live', appVersion, env = process.env }) {
  const sources = [];
  for (const config of configs) {
    const active = config.enabled !== false && config.implemented !== false;
    let meta = active ? await readJson(path.join(dataDir, 'sources', `${config.key}.json`)) : null;
    if (!meta) meta = active ? { ...unavailableMeta(config), status: 'failed' } : unavailableMeta(config);
    // Refresh the static description from config (it may have been edited) but keep run results.
    meta = { ...meta, ...metaBase(config) };
    meta.status = active ? computeSourceStatus(meta, now) : 'unavailable';
    sources.push(meta);
  }
  const manifest = {
    schemaVersion: 1,
    appVersion: appVersion ?? null,
    mode,
    generatedAtUtc: toIsoUtc(now),
    buildCommitSha: env.GITHUB_SHA || null,
    workflowRunUrl: workflowRunUrl(env),
    refreshNote:
      'Data refreshes are scheduled through GitHub Actions. Scheduled workflows can start later than their configured times, so timestamps show when this project actually fetched and published each source.',
    sources,
  };
  await writeJson(path.join(dataDir, 'manifest.json'), manifest, { pretty: true });
  return manifest;
}
