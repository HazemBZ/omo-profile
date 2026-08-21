/**
 * Mutation-lock diagnostics.
 *
 * Reads (never removes) the P3 lock files in the config and profiles
 * directories, then classifies each as absent, corrupt, stale (expired and
 * owning process dead), or active. Removal is left to a future --fix-lock.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PASS, WARN, result } from '../result.mjs';
import { humanAge } from '../format.mjs';

const STALE_MS = 5 * 60 * 1000;

function parseLockRecord(text) {
  try {
    const record = JSON.parse(text);
    if (
      Number.isSafeInteger(record.pid) && record.pid > 0 &&
      Number.isFinite(record.createdAt) && record.createdAt >= 0 &&
      typeof record.token === 'string' && record.token !== ''
    ) return record;
    return undefined;
  } catch { return undefined; }
}

/**
 * @param {object} ctx - Built doctor context (see run-doctor.mjs).
 * @returns {Promise<object[]>}
 */
export async function checkLockState(ctx) {
  const lockPaths = new Set();
  if (ctx.configDir) lockPaths.add(join(ctx.configDir, '.omo-profile.lock'));
  if (ctx.profilesDir) lockPaths.add(join(ctx.profilesDir, '.omo-profile.lock'));

  const found = [];
  for (const path of lockPaths) {
    let raw;
    try { raw = await readFile(path, 'utf-8'); } catch (error) {
      if (error?.code === 'ENOENT') continue; // no lock, fine
      found.push({ path, error });
      continue;
    }
    const record = parseLockRecord(raw);
    if (!record) {
      found.push({ path, corrupt: true });
    } else {
      found.push({ path, record });
    }
  }

  if (found.length === 0) {
    return [result({ id: 'lock.state', status: PASS, section: 'Locks', message: 'No active mutation lock' })];
  }

  return found.map(entry => {
    if (entry.error) {
      return result({ id: 'lock.state', status: WARN, section: 'Locks', message: 'Lock could not be read', details: [entry.path, entry.error.message], path: entry.path });
    }
    if (entry.corrupt) {
      return result({ id: 'lock.state', status: WARN, section: 'Locks', message: 'Corrupt lock detected', details: [entry.path], path: entry.path });
    }

    const age = ctx.now() - entry.record.createdAt;
    const expired = age >= STALE_MS;
    const alive = ctx.isProcessAlive(entry.record.pid);
    if (expired && !alive) {
      return result({
        id: 'lock.state',
        status: WARN,
        section: 'Locks',
        message: 'Stale lock detected',
        details: [`PID: ${entry.record.pid}`, `Created: ${humanAge(age)}`, entry.path],
        path: entry.path,
        pid: entry.record.pid,
        stale: true,
      });
    }
    return result({
      id: 'lock.state',
      status: WARN,
      section: 'Locks',
      message: 'Active lock detected',
      details: [`PID: ${entry.record.pid}`, `Created: ${humanAge(age)}`, entry.path],
      path: entry.path,
      pid: entry.record.pid,
    });
  });
}
