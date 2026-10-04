// HTTP helpers for the refresh scripts: timeouts, retries with backoff,
// an identifying User-Agent, and redaction so secrets never reach the logs.

const DEFAULT_UA =
  process.env.DATA_USER_AGENT ||
  `GlobalIncidentMap/1.0 (+https://github.com/${process.env.GITHUB_REPOSITORY || 'global-incident-map'})`;

const secrets = new Set();

/** Register a secret value so it is replaced with *** in any log or error text. */
export function registerSecret(value) {
  if (value && String(value).length >= 4) secrets.add(String(value));
}

export function redact(text) {
  let out = String(text ?? '');
  for (const s of secrets) out = out.split(s).join('***');
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * Fetch a URL and return the body as text. Retries network errors, timeouts,
 * HTTP 429 and 5xx with exponential backoff. 4xx (other than 429) fails fast.
 */
export async function fetchText(url, { timeoutMs = 60_000, retries = 3, headers = {}, log = console.log } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': DEFAULT_UA, Accept: '*/*', ...headers },
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = new HttpError(`HTTP ${res.status} ${res.statusText} for ${redact(url)}`, res.status);
        if (res.status !== 429 && res.status < 500) throw Object.assign(err, { fatal: true });
        throw err;
      }
      return await res.text();
    } catch (e) {
      lastError = e.name === 'AbortError' ? new Error(`Timed out after ${timeoutMs} ms: ${redact(url)}`) : e;
      if (e.fatal || attempt === retries) break;
      const wait = 2000 * 2 ** attempt;
      log(`  retry ${attempt + 1}/${retries} in ${wait / 1000}s: ${redact(lastError.message)}`);
      await sleep(wait);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(redact(lastError?.message || 'request failed'));
}

export async function fetchJson(url, options = {}) {
  const text = await fetchText(url, { ...options, headers: { Accept: 'application/json', ...(options.headers || {}) } });
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Response from ${redact(url)} was not valid JSON`);
  }
}

/** Run async `fn` over `items` with at most `limit` in flight. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
