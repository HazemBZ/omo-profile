/**
 * Storage + permissions diagnostics.
 *
 * Uses read-only filesystem capability checks (fs.access R_OK/W_OK and stat),
 * never mutating anything. Covers the profile directory, the active config
 * file, its parent directory (needed for atomic rename), and the atomic-write
 * prerequisites from P3.
 */

import { constants } from 'node:fs';
import { access as realAccess, stat as realStat } from 'node:fs/promises';
import { FAIL, PASS, SKIP, result } from '../result.mjs';

/**
 * @param {object} ctx - Built doctor context (see run-doctor.mjs).
 * @param {object} [deps] - Injectable fs dependencies for tests.
 * @param {(p: string, m: number) => Promise<void>} [deps.access]
 * @param {(p: string) => Promise<{isDirectory(): boolean}>} [deps.stat]
 * @returns {Promise<object[]>}
 */
export async function checkPermissions(ctx, deps = {}) {
  const access = deps.access ?? realAccess;
  const stat = deps.stat ?? realStat;

  async function can(path, mode) {
    try { await access(path, mode); return true; } catch { return false; }
  }

  async function isDirectory(path) {
    try { return (await stat(path)).isDirectory(); } catch { return false; }
  }

  const checks = [];

  // --- Profile storage ---------------------------------------------------
  if (await isDirectory(ctx.profilesDir)) {
    const readable = await can(ctx.profilesDir, constants.R_OK);
    const writable = await can(ctx.profilesDir, constants.W_OK);
    if (readable && writable) {
      checks.push(result({ id: 'storage.profiles', status: PASS, section: 'Storage', message: 'Profile storage: readable and writable', path: ctx.profilesDir }));
    } else {
      const missing = [];
      if (!readable) missing.push('not readable');
      if (!writable) missing.push('not writable');
      checks.push(result({ id: 'storage.profiles', status: FAIL, section: 'Storage', message: `Profile directory is ${missing.join(' and ')}`, details: [ctx.profilesDir], path: ctx.profilesDir }));
    }
  } else {
    // A missing profiles directory is expected on a fresh install, not a failure.
    checks.push(result({ id: 'storage.profiles', status: SKIP, section: 'Storage', message: 'Profile directory does not exist yet', details: [ctx.profilesDir], path: ctx.profilesDir }));
  }

  // --- Active config -----------------------------------------------------
  if (!ctx.discovery) {
    checks.push(result({ id: 'storage.config', status: SKIP, section: 'Storage', message: 'Config permission check skipped (no config found)' }));
    checks.push(result({ id: 'storage.atomic', status: SKIP, section: 'Storage', message: 'Atomic write check skipped (no config found)' }));
    return checks;
  }

  const configPath = ctx.discovery.path;
  const configDir = ctx.configDir;
  const configReadable = await can(configPath, constants.R_OK);
  const configWritable = await can(configPath, constants.W_OK);
  const parentWritable = await can(configDir, constants.W_OK);

  if (configReadable && configWritable && parentWritable) {
    checks.push(result({ id: 'storage.config', status: PASS, section: 'Storage', message: 'Config readable, writable, parent directory writable', path: configPath }));
  } else {
    const problems = [];
    if (!configReadable) problems.push('config not readable');
    if (!configWritable) problems.push('config not writable');
    if (!parentWritable) problems.push('parent directory not writable');
    checks.push(result({ id: 'storage.config', status: FAIL, section: 'Storage', message: `Config permissions: ${problems.join(', ')}`, details: [configPath], path: configPath }));
  }

  // Atomic-write prerequisites: temp writes to the same directory + that
  // directory is writable + existing file mode can be read.
  if (parentWritable && configWritable) {
    checks.push(result({ id: 'storage.atomic', status: PASS, section: 'Storage', message: 'Atomic writes supported', path: configPath }));
  } else {
    checks.push(result({ id: 'storage.atomic', status: FAIL, section: 'Storage', message: 'Atomic writes not supported (parent directory must be writable)', details: [configDir], path: configPath }));
  }

  return checks;
}
