import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function loadSourceConfigs() {
  const raw = JSON.parse(await fs.readFile(path.join(ROOT, 'config/sources.json'), 'utf8'));
  const disabled = new Set((process.env.DISABLED_SOURCES || '').split(',').map((s) => s.trim()).filter(Boolean));
  return raw.sources.map((s) => (disabled.has(s.key) ? { ...s, enabled: false } : s));
}

export async function appVersion() {
  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  return pkg.version;
}
