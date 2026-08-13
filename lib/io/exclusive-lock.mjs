import { randomBytes } from 'node:crypto';
import { link, lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { LockUnavailableError } from '../profile/lifecycle-errors.mjs';

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_POLL_MS = 50;
const DEFAULT_STALE_MS = 5 * 60_000;

const defaultSleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function parseLockRecord(bytes) {
  try {
    const record = JSON.parse(bytes.toString('utf8'));
    if (
      !Number.isSafeInteger(record?.pid) || record.pid <= 0 ||
      !Number.isFinite(record.createdAt) || record.createdAt < 0 ||
      typeof record.token !== 'string' || record.token.length === 0
    ) return undefined;
    return record;
  } catch {
    return undefined;
  }
}

async function writeOwnedLock(path, record) {
  const handle = await open(path, 'wx');
  try {
    await handle.writeFile(JSON.stringify(record));
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readLockRecord(path) {
  try {
    return parseLockRecord(await readFile(path));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    return undefined;
  }
}

async function readLockMtimeMs(path) {
  try {
    return (await lstat(path)).mtimeMs;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function restoreClaim(path, claimPath) {
  try {
    await link(claimPath, path);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  await unlink(claimPath);
  return false;
}

async function relinquishOwnedLock(path, token, beforeOwnershipUnlink, afterOwnershipRead) {
  await beforeOwnershipUnlink();
  const claimPath = `${path}.claim.${randomBytes(18).toString('base64url')}`;
  try {
    await rename(path, claimPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  await afterOwnershipRead(claimPath);
  const current = await readLockRecord(claimPath);
  if (!current || current.token !== token) return restoreClaim(path, claimPath);
  await unlink(claimPath);
  return true;
}

async function reclaimCorruptLock(path, beforeOwnershipUnlink, afterOwnershipRead) {
  await beforeOwnershipUnlink();
  const claimPath = `${path}.claim.${randomBytes(18).toString('base64url')}`;
  try {
    await rename(path, claimPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  await afterOwnershipRead(claimPath);
  const current = await readLockRecord(claimPath);
  if (current) return restoreClaim(path, claimPath);
  await unlink(claimPath);
  return true;
}

/**
 * Acquire an exclusive local lock. A valid lock is reclaimed only after its
 * metadata is expired and its PID is confirmed dead. A corrupt lock (a partial
 * write left by a crash between open('wx') and sync) is reclaimed only once its
 * mtime is older than staleMs. Release and every reclaim atomically rename the
 * lock into a private claim, then delete only that claim. A token mismatch or a
 * competing valid replacement restores the claim with no-clobber link;
 * restoration conflict stays unavailable.
 */
export async function acquireExclusiveLock({
  path,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollMs = DEFAULT_POLL_MS,
  staleMs = DEFAULT_STALE_MS,
  clock = Date.now,
  sleep = defaultSleep,
  isProcessAlive = pid => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error?.code !== 'ESRCH';
    }
  },
  randomToken = () => randomBytes(18).toString('base64url'),
  beforeOwnershipUnlink = async () => {},
  afterOwnershipRead = async () => {},
} = {}) {
  const startedAt = clock();
  const record = { pid: process.pid, createdAt: startedAt, token: randomToken() };
  for (;;) {
    try {
      await writeOwnedLock(path, record);
      return {
        async release() {
          if (!await relinquishOwnedLock(path, record.token, beforeOwnershipUnlink, afterOwnershipRead)) {
            throw new LockUnavailableError(`Lock ownership changed: ${path}`);
          }
        },
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }

    const current = await readLockRecord(path);
    if (current === undefined) {
      const mtimeMs = await readLockMtimeMs(path);
      if (mtimeMs === null) continue;
      if (clock() - mtimeMs >= staleMs && await reclaimCorruptLock(path, beforeOwnershipUnlink, afterOwnershipRead)) continue;
    } else if (current) {
      const expired = clock() - current.createdAt >= staleMs;
      if (expired && !isProcessAlive(current.pid)) {
        if (await relinquishOwnedLock(path, current.token, beforeOwnershipUnlink, afterOwnershipRead)) continue;
      }
    }
    if (clock() - startedAt >= timeoutMs) throw new LockUnavailableError(`Lock unavailable: ${path}`);
    await sleep(pollMs);
  }
}

/** Create a transaction function accepted by ProfileStore and ConfigStore. */
export function createLockedTransaction(path, options = {}) {
  return async action => {
    const lock = await acquireExclusiveLock({ path, ...options });
    try {
      return await action();
    } finally {
      await lock.release();
    }
  };
}

/** Create a per-profile-directory transaction factory for ProfileStore injection. */
export function createProfileDirectoryTransaction(directory, options = {}) {
  return createLockedTransaction(join(directory, '.omo-profile.lock'), options);
}

/** Factory form for injecting one lock per ProfileStore directory. */
export function createProfileStoreTransaction(options = {}) {
  return directory => createProfileDirectoryTransaction(directory, options);
}

/** Create a config-adjacent transaction function for ConfigStore injection. */
export function createConfigTransaction(configPath, options = {}) {
  return createLockedTransaction(join(dirname(configPath), '.omo-profile.lock'), options);
}
