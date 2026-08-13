import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LockUnavailableError } from '../profile/lifecycle-errors.mjs';
import { acquireExclusiveLock, createConfigTransaction } from './exclusive-lock.mjs';

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'omo-exclusive-lock-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function lockRecord({ pid = 22, createdAt = 1_000, token = 'owner-token' } = {}) {
  return JSON.stringify({ pid, createdAt, token });
}

function lockOptions(path, overrides = {}) {
  return {
    path,
    clock: () => 2_000,
    timeoutMs: 0,
    sleep: async () => { throw new Error('unexpected poll'); },
    isProcessAlive: () => true,
    randomToken: () => 'new-token',
    ...overrides,
  };
}

describe('acquireExclusiveLock', () => {
  it('treats fresh locks and malformed locks as busy', async (t) => {
    const directory = await temporaryDirectory(t);
    const path = join(directory, 'mutate.lock');
    await writeFile(path, lockRecord());
    await assert.rejects(acquireExclusiveLock(lockOptions(path)), LockUnavailableError);

    await writeFile(path, 'not json');
    await assert.rejects(acquireExclusiveLock(lockOptions(path)), LockUnavailableError);
  });

  it('reclaims only expired locks whose owner PID is dead', async (t) => {
    const directory = await temporaryDirectory(t);
    const path = join(directory, 'mutate.lock');
    await writeFile(path, lockRecord({ createdAt: 1, pid: 22 }));

    const lock = await acquireExclusiveLock(lockOptions(path, {
      staleMs: 1_000,
      isProcessAlive: () => false,
    }));

    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
      pid: process.pid,
      createdAt: 2_000,
      token: 'new-token',
    });
    await lock.release();
  });

  it('reclaims a corrupt lock whose mtime is stale', async (t) => {
    const directory = await temporaryDirectory(t);
    const path = join(directory, 'mutate.lock');
    await writeFile(path, '{bad');
    await utimes(path, new Date(500), new Date(500));

    const lock = await acquireExclusiveLock(lockOptions(path, { staleMs: 1_000 }));

    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
      pid: process.pid,
      createdAt: 2_000,
      token: 'new-token',
    });
    await lock.release();
  });

  it('does not reclaim a corrupt lock whose mtime is fresh', async (t) => {
    const directory = await temporaryDirectory(t);
    const path = join(directory, 'mutate.lock');
    await writeFile(path, '{bad');
    await utimes(path, new Date(1_500), new Date(1_500));

    await assert.rejects(acquireExclusiveLock(lockOptions(path, { staleMs: 1_000 })), LockUnavailableError);
    assert.equal(await readFile(path, 'utf8'), '{bad');
  });

  it('preserves a replacement owner during corrupt reclaim race', async (t) => {
    const directory = await temporaryDirectory(t);
    const path = join(directory, 'mutate.lock');
    await writeFile(path, '{bad');
    await utimes(path, new Date(500), new Date(500));

    await assert.rejects(acquireExclusiveLock(lockOptions(path, {
      staleMs: 1_000,
      beforeOwnershipUnlink: async () => writeFile(path, lockRecord({ token: 'replacement-token' })),
    })), LockUnavailableError);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).token, 'replacement-token');
  });

  it('treats expired locks with a live PID as busy', async (t) => {
    const directory = await temporaryDirectory(t);
    const path = join(directory, 'mutate.lock');
    await writeFile(path, lockRecord({ createdAt: 1 }));

    await assert.rejects(
      acquireExclusiveLock(lockOptions(path, { staleMs: 1_000, isProcessAlive: () => true })),
      LockUnavailableError,
    );
  });

  it('does not release a lock replaced by another owner token', async (t) => {
    const directory = await temporaryDirectory(t);
    const path = join(directory, 'mutate.lock');
    const lock = await acquireExclusiveLock(lockOptions(path));
    await writeFile(path, lockRecord({ token: 'replacement-token' }));

    await assert.rejects(lock.release(), LockUnavailableError);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).token, 'replacement-token');
  });

  it('uses the profile-directory lock path for config transactions', async (t) => {
    const directory = await temporaryDirectory(t);
    const configPath = join(directory, 'config.jsonc');
    const transaction = createConfigTransaction(configPath, { randomToken: () => 'config-token' });

    await transaction(async () => {
      const record = JSON.parse(await readFile(join(directory, '.omo-profile.lock'), 'utf8'));
      assert.equal(record.pid, process.pid);
      assert.equal(typeof record.createdAt, 'number');
      assert.equal(record.token, 'config-token');
    });
  });

  it('preserves a replacement owner during stale reclaim race', async (t) => {
    const directory = await temporaryDirectory(t);
    const path = join(directory, 'mutate.lock');
    await writeFile(path, lockRecord({ createdAt: 1, token: 'stale-token' }));

    await assert.rejects(acquireExclusiveLock(lockOptions(path, {
      staleMs: 1_000,
      isProcessAlive: () => false,
      beforeOwnershipUnlink: async () => writeFile(path, lockRecord({ token: 'replacement-token' })),
    })), LockUnavailableError);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).token, 'replacement-token');
  });

  it('preserves a replacement owner during release race', async (t) => {
    const directory = await temporaryDirectory(t);
    const path = join(directory, 'mutate.lock');
    const lock = await acquireExclusiveLock(lockOptions(path, {
      beforeOwnershipUnlink: async () => writeFile(path, lockRecord({ token: 'replacement-token' })),
    }));

    await assert.rejects(lock.release(), LockUnavailableError);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).token, 'replacement-token');
  });

  it('preserves a replacement written after token validation before release unlink', async (t) => {
    const directory = await temporaryDirectory(t);
    const path = join(directory, 'mutate.lock');
    const lock = await acquireExclusiveLock(lockOptions(path, {
      afterOwnershipRead: async () => writeFile(path, lockRecord({ token: 'replacement-token' })),
    }));

    await lock.release();
    assert.equal(JSON.parse(await readFile(path, 'utf8')).token, 'replacement-token');
  });

  it('removes owned claim when a replacement blocks no-clobber restoration', async (t) => {
    const directory = await temporaryDirectory(t);
    const path = join(directory, 'mutate.lock');
    const lock = await acquireExclusiveLock(lockOptions(path, {
      afterOwnershipRead: async claimPath => {
        await writeFile(path, lockRecord({ token: 'replacement-token' }));
        await writeFile(claimPath, lockRecord({ token: 'other-token' }));
      },
    }));

    await assert.rejects(lock.release(), LockUnavailableError);

    assert.equal(JSON.parse(await readFile(path, 'utf8')).token, 'replacement-token');
    assert.deepEqual((await readdir(directory)).filter(name => name.includes('.claim.')), []);
  });
});
