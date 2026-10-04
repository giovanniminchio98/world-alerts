import fs from 'node:fs/promises';
import path from 'node:path';

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Write JSON atomically (temp file + rename) so a crash never leaves a
 * half-written file in place of the last valid one. `pretty` is used for
 * small human-readable metadata; large data files are written compactly.
 */
export async function writeJson(file, data, { pretty = false } = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, pretty ? 2 : 0)}\n`);
  await fs.rename(tmp, file);
}

export async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Replace directory `dest` with `src` (used to swap a fully written tile set into place). */
export async function replaceDir(src, dest) {
  const old = `${dest}.old-${process.pid}`;
  if (await exists(dest)) await fs.rename(dest, old);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.rename(src, dest);
  await fs.rm(old, { recursive: true, force: true });
}
