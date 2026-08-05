/**
 * Path resolution and I/O helpers for the profile manager.
 *
 * Exposes config/profile path resolution (with env var overrides),
 * JSON reading, profile file listing, atomic config writes,
 * and timestamped backups.
 */

import { readFile, writeFile, rename, copyFile, unlink, mkdir } from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import { basename, dirname, join } from 'path';
import { homedir } from 'os';

// ---------------------------------------------------------------------------
// Path resolution  (env overrides for testing)
// ---------------------------------------------------------------------------
const HOME = homedir();
const DEFAULT_CONFIG_PATH = join(HOME, '.config', 'opencode', 'oh-my-openagent.json');
const DEFAULT_PROFILES_DIR = join(HOME, '.config', 'opencode', 'omo-profiles');

export function configPath() {
  return process.env.OMO_CONFIG_PATH || DEFAULT_CONFIG_PATH;
}

export function profilesDir() {
  return process.env.OMO_PROFILES_DIR || DEFAULT_PROFILES_DIR;
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
    .filter(f => f.endsWith('.json'))
    .sort();
}

export function idFromFilename(filename) {
  return filename.replace(/\.json$/, '');
}

export function filenameFromId(id) {
  return `${id}.json`;
}

// ---------------------------------------------------------------------------
// Atomic write  (write to temp in same dir, rename)
// ---------------------------------------------------------------------------

/**
 * Write `data` to `filePath` atomically via a temp file in the same
 * directory, then rename.  Cleans up the temp file if the write or
 * rename fails.
 *
 * @param {string} filePath
 * @param {string} data  — already-serialised string
 */
export async function atomicWrite(filePath, data) {
  const tmp = join(
    dirname(filePath),
    `.${basename(filePath)}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`,
  );
  try {
    await writeFile(tmp, data, 'utf-8');
    await rename(tmp, filePath);
  } catch (err) {
    try {
      await unlink(tmp);
    } catch (cleanupErr) {
      if (cleanupErr.code !== 'ENOENT') {
        console.error(`Failed to remove temporary profile file ${tmp}: ${cleanupErr.message}`);
      }
    }
    throw err;
  }
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
