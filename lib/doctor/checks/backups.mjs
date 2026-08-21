/**
 * Backup health diagnostics.
 *
 * Counts backups that match the CURRENT P3 naming scheme
 * (<configName>.backup-<13-digit-millis>-<base64url>) — the same set that
 * `backups`, `prune`, and `restore` operate on — and reports their newest /
 * oldest / total size. Also flags stale temporary files left behind by a
 * crashed write.
 *
 * Legacy .bak-<ISO> / .backup-<ISO> files predate P3 and are intentionally
 * out of scope (the prune command cannot remove them).
 */

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { PASS, SKIP, WARN, result } from '../result.mjs';
import { formatSize, humanAge } from '../format.mjs';

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function backupPattern(configName) {
  return new RegExp(`^${escapeRegex(configName)}\\.backup-(\\d{13})-([A-Za-z0-9_-]+)$`);
}

async function listDir(dir) {
  try { return await readdir(dir); } catch { return []; }
}

/**
 * @param {object} ctx - Built doctor context (see run-doctor.mjs).
 * @returns {Promise<object[]>}
 */
export async function checkBackups(ctx) {
  const checks = [];

  // --- Backup accumulation ------------------------------------------------
  if (ctx.configDir && ctx.configName) {
    const pattern = backupPattern(ctx.configName);
    const names = (await listDir(ctx.configDir)).filter(name => pattern.test(name));

    if (names.length === 0) {
      checks.push(result({ id: 'backups.count', status: PASS, section: 'Backups', message: 'No backups' }));
    } else {
      const stats = [];
      for (const name of names) {
        try { stats.push(await stat(join(ctx.configDir, name))); } catch { /* vanished mid-scan */ }
      }
      const totalSize = stats.reduce((sum, s) => sum + s.size, 0);
      const mtimes = stats.map(s => s.mtimeMs);
      const details = [];
      if (mtimes.length > 0) {
        const nowMs = ctx.now();
        details.push(`newest: ${humanAge(nowMs - Math.max(...mtimes))}`);
        details.push(`oldest: ${humanAge(nowMs - Math.min(...mtimes))}`);
      }
      details.push(`size: ${formatSize(totalSize)}`);

      if (names.length > ctx.maxBackups) {
        details.push('Consider: omo-profile backups prune --keep 20');
        checks.push(result({ id: 'backups.count', status: WARN, section: 'Backups', message: `${names.length} backups found`, details, count: names.length }));
      } else {
        checks.push(result({ id: 'backups.count', status: PASS, section: 'Backups', message: `${names.length} backup${names.length === 1 ? '' : 's'}`, details, count: names.length }));
      }
    }
  } else {
    checks.push(result({ id: 'backups.count', status: SKIP, section: 'Backups', message: 'Backup check skipped (no config found)' }));
  }

  // --- Stale temporary files ----------------------------------------------
  const tempFiles = [];
  if (ctx.configDir) {
    for (const name of await listDir(ctx.configDir)) {
      if (name.startsWith('.') && name.includes('.tmp')) tempFiles.push(join(ctx.configDir, name));
    }
  }
  for (const name of await listDir(ctx.profilesDir)) {
    if (/\.tmp-\d+-\d+$/.test(name)) tempFiles.push(join(ctx.profilesDir, name));
  }

  checks.push(tempFiles.length === 0
    ? result({ id: 'backups.temp', status: PASS, section: 'Backups', message: 'No stale temporary files' })
    : result({ id: 'backups.temp', status: WARN, section: 'Backups', message: `${tempFiles.length} stale temporary file${tempFiles.length === 1 ? '' : 's'} found`, details: tempFiles, files: tempFiles }));

  return checks;
}
