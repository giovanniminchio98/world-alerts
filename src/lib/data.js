// Loading published static data (manifest, per-source files) from ./data/.
// The manifest is always revalidated; data files carry a version query string
// (the source's last successful fetch time) so browsers and the Pages CDN can
// cache unchanged files while still picking up new refreshes.

const base = () => new URL('data/', document.baseURI);

async function getJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

export function loadManifest() {
  return getJson(new URL(`manifest.json?t=${Date.now()}`, base()), { cache: 'no-cache' });
}

export async function loadPublishInfo() {
  try {
    return await getJson(new URL(`publish.json?t=${Date.now()}`, base()), { cache: 'no-cache' });
  } catch {
    return null;
  }
}

export function loadDataFile(path, version) {
  const v = version ? `?v=${encodeURIComponent(version)}` : '';
  return getJson(new URL(`${path}${v}`, base()));
}

export const sourceVersion = (meta) => meta?.lastSuccessfulFetchUtc || meta?.lastAttemptUtc || '';

/** Incident file path for a source key (convention used by the refresh scripts). */
export const incidentPath = (key) => `incidents/${key}.json`;
