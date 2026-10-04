// Time helpers. All published data stores times as ISO-8601 UTC strings.

/**
 * Parse a timestamp to epoch milliseconds. Accepts ISO strings (a string with
 * no timezone designator is treated as UTC, as GDACS publishes), epoch numbers
 * and Date objects. Returns null when the input is missing or invalid.
 */
export function parseUtc(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s = `${s.replace(' ', 'T')}Z`;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

/** Epoch ms (or parseable value) → canonical "YYYY-MM-DDTHH:MM:SSZ" (no millis). */
export function toIsoUtc(value) {
  const ms = parseUtc(value);
  if (ms == null) return null;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Human-readable date/time. `utc: true` shows UTC, otherwise the viewer's
 * local timezone (with its abbreviation). `timeZone` overrides for tests.
 */
export function formatDateTime(value, { utc = false, timeZone, withZone = true, locale = 'en-GB' } = {}) {
  const ms = parseUtc(value);
  if (ms == null) return 'unknown';
  const opts = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: utc ? 'UTC' : timeZone,
  };
  if (withZone) opts.timeZoneName = 'short';
  return new Intl.DateTimeFormat(locale, opts).format(new Date(ms));
}

/** Compact relative time, e.g. "just now", "12 min ago", "3 h ago", "2 days ago", "in 4 h". */
export function formatRelative(value, now = Date.now()) {
  const ms = parseUtc(value);
  if (ms == null) return 'unknown';
  const diff = now - ms;
  const future = diff < 0;
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60_000);
  let text;
  if (min < 1) return future ? 'in under a minute' : 'just now';
  if (min < 60) text = `${min} min`;
  else if (min < 48 * 60) {
    const h = Math.round(min / 60);
    text = `${h} h`;
  } else {
    const d = Math.round(min / 1440);
    text = `${d} day${d === 1 ? '' : 's'}`;
  }
  return future ? `in ${text}` : `${text} ago`;
}

/** Duration in minutes → "15 min", "2 h", "3 days". */
export function formatDuration(minutes) {
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h`;
  const d = Math.round(minutes / 1440);
  return `${d} day${d === 1 ? '' : 's'}`;
}

/** Selectable time windows (minutes). */
export const TIME_WINDOWS = {
  '1h': { minutes: 60, label: 'Last hour', short: '1 h' },
  '24h': { minutes: 1440, label: 'Last 24 hours', short: '24 h' },
  '48h': { minutes: 2880, label: 'Last 48 hours', short: '48 h' },
  '7d': { minutes: 10080, label: 'Last 7 days', short: '7 days' },
};

export function windowMinutes(key) {
  return TIME_WINDOWS[key]?.minutes ?? TIME_WINDOWS['24h'].minutes;
}
