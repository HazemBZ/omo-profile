/**
 * Path resolution and I/O helpers for the profile manager.
 *
 * Exposes config/profile path resolution (with env var overrides),
 * JSON reading, profile file listing, atomic config writes,
 * and timestamped backups.
 */

import { readFile, copyFile, mkdir } from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
export { atomicWrite } from './io/atomic-write.mjs';

// ---------------------------------------------------------------------------
// Path resolution  (env overrides for testing)
// ---------------------------------------------------------------------------
const HOME = homedir();
const DEFAULT_CONFIG_PATH = join(HOME, '.config', 'opencode', 'oh-my-openagent.json');
const DEFAULT_PROFILES_DIR = join(HOME, '.config', 'opencode', 'omo-profiles');
const DEFAULT_BUNDLED_PROFILES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'profiles',
);

export function configPath() {
  return process.env.OMO_CONFIG_PATH || DEFAULT_CONFIG_PATH;
}

export function profilesDir() {
  return process.env.OMO_PROFILES_DIR || DEFAULT_PROFILES_DIR;
}

/**
 * Directory of bundled starter profiles shipped with the package.
 */
export function bundledProfilesDir() {
  return process.env.OMO_BUNDLED_PROFILES_DIR || DEFAULT_BUNDLED_PROFILES_DIR;
}

// ---------------------------------------------------------------------------
// JSON I/O
// ---------------------------------------------------------------------------

export async function readJson(path) {
  const raw = await readFile(path, 'utf-8');
  return JSON.parse(raw);
}

export function listProfileFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.json') && !f.startsWith('.profile-backup-'))
    .sort();
}

export function idFromFilename(filename) {
  return filename.replace(/\.json$/, '');
}

export function filenameFromId(id) {
  return `${id}.json`;
}

// ---------------------------------------------------------------------------
// Timestamped backup  (same directory, .bak-<ISO> suffix)
// ---------------------------------------------------------------------------

/**
 * Copy `src` to a timestamped backup path and return the backup path.
 */
export async function backupFile(src) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = `${src}.bak-${ts}`;
  await copyFile(src, backupPath);
  return backupPath;
}

// ---------------------------------------------------------------------------
// Profile I/O convenience
// ---------------------------------------------------------------------------

/**
 * Resolve the full path for a profile id under the profiles directory.
 */
export function profilePath(dir, id) {
  return join(dir, filenameFromId(id));
}

/**
 * Ensure the profiles directory exists (create recursively if needed).
 */
export async function ensureProfilesDir(dir) {
  await mkdir(dir, { recursive: true });
}

/**
 * Seed bundled starter profiles into `dir`.
 *
 * Copies every JSON profile from the bundled profiles directory into `dir`
 * when the target file is missing. Existing files are never overwritten, so
 * user edits and bundles with the same id always win. Non-JSON files in the
 * bundle (e.g. a README) are ignored.
 *
 * Returns the number of profiles copied.
 */
export async function ensureBundledProfiles(dir) {
  const bundle = bundledProfilesDir();
  const files = listProfileFiles(bundle);
  if (files.length === 0) return 0;

  await ensureProfilesDir(dir);

  let seeded = 0;
  for (const file of files) {
    const target = join(dir, file);
    if (existsSync(target)) continue;
    await copyFile(join(bundle, file), target);
    seeded += 1;
  }
  return seeded;
}
