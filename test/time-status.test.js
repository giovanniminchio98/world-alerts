import { describe, expect, it } from 'vitest';
import { formatDateTime, formatDuration, formatRelative, parseUtc, toIsoUtc, windowMinutes } from '../src/shared/time.js';
import { computeSourceStatus, describeSourceStatus, isPublishOlderThanExpected } from '../src/shared/status.js';

const NOW = Date.parse('2026-10-04T12:00:00Z');
const minsAgo = (m) => new Date(NOW - m * 60_000).toISOString();

describe('time parsing and formatting', () => {
  it('treats timestamps without a zone as UTC (GDACS style)', () => {
    expect(parseUtc('2026-10-04T10:00:00')).toBe(Date.parse('2026-10-04T10:00:00Z'));
    expect(parseUtc('2026-10-04 10:00')).toBe(Date.parse('2026-10-04T10:00:00Z'));
  });
  it('accepts epoch ms, ISO with offsets and RFC 1123, rejects junk', () => {
    expect(parseUtc(1759572000000)).toBe(1759572000000);
    expect(parseUtc('2026-10-04T12:00:00+02:00')).toBe(Date.parse('2026-10-04T10:00:00Z'));
    expect(parseUtc('Sun, 04 Oct 2026 12:00:00 GMT')).toBe(NOW);
    expect(parseUtc('not a date')).toBeNull();
    expect(parseUtc(null)).toBeNull();
    expect(parseUtc('')).toBeNull();
  });
  it('produces canonical UTC ISO strings', () => {
    expect(toIsoUtc(NOW + 123)).toBe('2026-10-04T12:00:00Z');
    expect(toIsoUtc('garbage')).toBeNull();
  });
  it('formats relative times', () => {
    expect(formatRelative(minsAgo(0), NOW)).toBe('just now');
    expect(formatRelative(minsAgo(12), NOW)).toBe('12 min ago');
    expect(formatRelative(minsAgo(180), NOW)).toBe('3 h ago');
    expect(formatRelative(minsAgo(60 * 24 * 3), NOW)).toBe('3 days ago');
    expect(formatRelative(new Date(NOW + 4 * 3_600_000).toISOString(), NOW)).toBe('in 4 h');
    expect(formatRelative(null, NOW)).toBe('unknown');
  });
  it('formats absolute times in UTC or a given zone', () => {
    expect(formatDateTime('2026-10-04T12:05:00Z', { utc: true })).toMatch(/4 Oct 2026.*12:05.*UTC/);
    expect(formatDateTime('2026-10-04T12:05:00Z', { timeZone: 'Asia/Tokyo' })).toMatch(/21:05/);
    expect(formatDateTime(null)).toBe('unknown');
  });
  it('formats durations and windows', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(180)).toBe('3 h');
    expect(formatDuration(4320)).toBe('3 days');
    expect(windowMinutes('7d')).toBe(10080);
    expect(windowMinutes('bogus')).toBe(1440);
  });
});

describe('source status', () => {
  const base = { enabled: true, implemented: true, staleAfterMinutes: 45 };
  it('is ok when the last successful fetch is within the threshold', () => {
    expect(computeSourceStatus({ ...base, lastSuccessfulFetchUtc: minsAgo(10), lastAttemptOk: true }, NOW)).toBe('ok');
  });
  it('stays ok (with a note) when the latest attempt failed but recent data exists', () => {
    const d = describeSourceStatus({ ...base, lastSuccessfulFetchUtc: minsAgo(20), lastAttemptOk: false }, NOW);
    expect(d.status).toBe('ok');
    expect(d.lastAttemptFailed).toBe(true);
  });
  it('is stale when no successful fetch happened within the threshold', () => {
    expect(computeSourceStatus({ ...base, lastSuccessfulFetchUtc: minsAgo(46), lastAttemptOk: true }, NOW)).toBe('stale');
  });
  it('is failed when the latest attempt failed and no recent valid data exists', () => {
    expect(computeSourceStatus({ ...base, lastSuccessfulFetchUtc: minsAgo(300), lastAttemptOk: false }, NOW)).toBe('failed');
    const none = describeSourceStatus({ ...base, lastSuccessfulFetchUtc: null, lastAttemptOk: false }, NOW);
    expect(none.status).toBe('failed');
    expect(none.hasData).toBe(false);
  });
  it('is unavailable when disabled, not implemented or missing', () => {
    expect(computeSourceStatus({ ...base, enabled: false }, NOW)).toBe('unavailable');
    expect(computeSourceStatus({ ...base, implemented: false }, NOW)).toBe('unavailable');
    expect(computeSourceStatus(null, NOW)).toBe('unavailable');
  });
  it('flags a published update that is older than expected', () => {
    expect(isPublishOlderThanExpected({ generatedAtUtc: minsAgo(30) }, NOW)).toBe(false);
    expect(isPublishOlderThanExpected({ generatedAtUtc: minsAgo(200) }, NOW)).toBe(true);
    expect(isPublishOlderThanExpected({}, NOW)).toBe(true);
  });
});
