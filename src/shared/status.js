// Source freshness / status logic shared by the refresh scripts and the browser.
//
//  ok          – latest successful project fetch is within `staleAfterMinutes`.
//  stale       – no successful fetch within `staleAfterMinutes`, and the latest
//                recorded attempt did not fail (e.g. the scheduled workflow was
//                delayed or has not run).
//  failed      – the latest attempt failed and there is no recent valid data
//                (either no data at all, or only data older than the threshold).
//  unavailable – the source is intentionally disabled / not implemented, or does
//                not cover the selected location.

import { parseUtc } from './time.js';

export const STATUSES = ['ok', 'stale', 'failed', 'unavailable'];

export function computeSourceStatus(meta, now = Date.now()) {
  return describeSourceStatus(meta, now).status;
}

/**
 * Returns `{ status, hasData, lastAttemptFailed, ageMinutes, lastSuccessMs }`.
 * `ageMinutes` is the age of the latest successful project fetch.
 */
export function describeSourceStatus(meta, now = Date.now()) {
  if (!meta || meta.enabled === false || meta.implemented === false) {
    return { status: 'unavailable', hasData: false, lastAttemptFailed: false, ageMinutes: null, lastSuccessMs: null };
  }
  const lastSuccessMs = parseUtc(meta.lastSuccessfulFetchUtc);
  const lastAttemptFailed = meta.lastAttemptOk === false;
  const staleAfterMs = (Number(meta.staleAfterMinutes) || 60) * 60_000;
  if (lastSuccessMs == null) {
    return { status: 'failed', hasData: false, lastAttemptFailed, ageMinutes: null, lastSuccessMs: null };
  }
  const ageMs = Math.max(0, now - lastSuccessMs);
  const ageMinutes = Math.round(ageMs / 60_000);
  if (ageMs <= staleAfterMs) {
    return { status: 'ok', hasData: true, lastAttemptFailed, ageMinutes, lastSuccessMs };
  }
  return { status: lastAttemptFailed ? 'failed' : 'stale', hasData: true, lastAttemptFailed, ageMinutes, lastSuccessMs };
}

/**
 * True when the published site build (manifest.generatedAtUtc) is older than
 * expected. The most frequent source refreshes every ~15 minutes, so an update
 * older than `thresholdMinutes` suggests scheduled runs are delayed or failing.
 */
export function isPublishOlderThanExpected(manifest, now = Date.now(), thresholdMinutes = 120) {
  const generated = parseUtc(manifest?.generatedAtUtc);
  if (generated == null) return true;
  return now - generated > thresholdMinutes * 60_000;
}
