import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdtemp, readFile, readdir, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore, InvalidConfigError, MissingBackupError } from './config-store.mjs';

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'omo-config-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function createStore(configPath, overrides = {}) {
  return new ConfigStore({
    configPath,
    clock: () => 1_725_000_000_123,
    randomSuffix: () => 'fixedsuffix',
    ...overrides,
  });
}

describe('ConfigStore backup contracts', () => {
  it('refuses a symlinked active config without changing either path', async (t) => {
    const directory = await temporaryDirectory(t);
    const target = join(directory, 'real.jsonc');
    const configPath = join(directory, 'config.jsonc');
    await writeFile(target, '{"safe":true}\n');
    await symlink(target, configPath);

    await assert.rejects(createStore(configPath).backup(), InvalidConfigError);

    assert.equal(await readFile(target, 'utf8'), '{"safe":true}\n');
    assert.equal((await lstat(configPath)).isSymbolicLink(), true);
  });

  it('publishes collision-safe same-directory backup copies without auto-pruning', async (t) => {
    const directory = await temporaryDirectory(t);
    const configPath = join(directory, 'oh-my-openagent.jsonc');
    const original = Buffer.from('\ufeff{\r\n  // preserve\r\n  "agents": {},\r\n}\r\n');
    await writeFile(configPath, original);
    const suffixes = ['collision', 'published'];
    const store = createStore(configPath, { randomSuffix: () => suffixes.shift() });
    await writeFile(join(directory, 'oh-my-openagent.jsonc.backup-1725000000123-collision'), 'older');

    const backup = await store.backup();

    assert.match(backup.id, /^1725000000123-published$/);
    assert.equal(await readFile(backup.path, 'utf8'), original.toString('utf8'));
    assert.deepEqual((await store.list()).map(record => record.id), [backup.id, '1725000000123-collision']);
  });

  it('lists only fully published recognized backups newest-first and prunes only on request', async (t) => {
    const directory = await temporaryDirectory(t);
    const configPath = join(directory, 'config.jsonc');
    await writeFile(configPath, '{}');
    for (const name of [
      'config.jsonc.backup-1725000000121-z',
      'config.jsonc.backup-1725000000123-a',
      'config.jsonc.backup-1725000000122-m',
      'config.jsonc.backup-invalid',
      '.config.jsonc.backup-1725000000124-temp.tmp',
    ]) await writeFile(join(directory, name), '{}');
    const store = createStore(configPath);

    assert.deepEqual((await store.list()).map(record => record.id), [
      '1725000000123-a', '1725000000122-m', '1725000000121-z',
    ]);
    assert.deepEqual((await store.prune(2)).map(record => record.id), ['1725000000121-z']);
    assert.deepEqual((await store.list()).map(record => record.id), ['1725000000123-a', '1725000000122-m']);
  });
});

describe('ConfigStore restore contracts', () => {
  it('keeps active bytes and a usable backup when rendered replacement fails after backup', async (t) => {
    const directory = await temporaryDirectory(t);
    const configPath = join(directory, 'config.jsonc');
    const current = Buffer.from('{"current":true}\n');
    await writeFile(configPath, current);
    const store = createStore(configPath, {
      replace: async () => { throw Object.assign(new Error('injected failure'), { code: 'EIO' }); },
    });

    await assert.rejects(store.replaceRendered(async () => '{"next":true}\n'), { code: 'EIO' });

    assert.deepEqual(await readFile(configPath), current);
    const [backup] = await store.list();
    assert.deepEqual(await readFile(backup.path), current);
  });

  it('rejects a config symlink introduced after backup publication before replacement', async (t) => {
    const directory = await temporaryDirectory(t);
    const configPath = join(directory, 'config.jsonc');
    const redirected = join(directory, 'redirected.jsonc');
    await writeFile(configPath, '{"current":true}\n');
    await writeFile(redirected, '{"redirected":true}\n');
    let publishCount = 0;
    const store = createStore(configPath, {
      publish: async (temporary, target) => {
        await rename(temporary, target);
        publishCount += 1;
        if (publishCount === 2) {
          await unlink(configPath);
          await symlink(redirected, configPath);
        }
      },
    });
    const backup = await store.backup();
    await writeFile(backup.path, '{"restored":true}\n');

    await assert.rejects(store.restore(backup.id), InvalidConfigError);

    assert.equal(await readFile(redirected, 'utf8'), '{"redirected":true}\n');
    assert.equal((await lstat(configPath)).isSymbolicLink(), true);
  });

  it('rejects a config symlink introduced after restore temp flush before replacement', async (t) => {
    const directory = await temporaryDirectory(t);
    const configPath = join(directory, 'config.jsonc');
    const redirected = join(directory, 'redirected.jsonc');
    await writeFile(configPath, '{"current":true}\n');
    await writeFile(redirected, '{"redirected":true}\n');
    const suffixes = ['source', 'current', 'restore'];
    const store = createStore(configPath, {
      randomSuffix: () => suffixes.shift(),
      beforeReplace: async () => {
        await unlink(configPath);
        await symlink(redirected, configPath);
      },
    });
    const backup = await store.backup();
    await writeFile(backup.path, '{"restored":true}\n');

    await assert.rejects(store.restore(backup.id), InvalidConfigError);

    assert.equal(await readFile(redirected, 'utf8'), '{"redirected":true}\n');
    assert.equal((await lstat(configPath)).isSymbolicLink(), true);
  });

  it('validates JSONC then backs up active bytes before atomically replacing exact backup bytes', async (t) => {
    const directory = await temporaryDirectory(t);
    const configPath = join(directory, 'config.jsonc');
    const current = Buffer.from('{\n  "current": true\n}\n');
    const backupBytes = Buffer.from('\ufeff{\r\n  // exact bytes\r\n  "restored": true,\r\n}\r\n');
    await writeFile(configPath, current);
    const suffixes = ['restore-source', 'restore-current'];
    const store = createStore(configPath, { randomSuffix: () => suffixes.shift() });
    const backup = await store.backup();
    await writeFile(backup.path, backupBytes);

    const restored = await store.restore(backup.id);

    assert.equal(restored.id, backup.id);
    assert.deepEqual(await readFile(configPath), backupBytes);
    const records = await store.list();
    assert.equal(records.length, 2);
    assert.deepEqual(await readFile(records.find(record => record.id !== backup.id).path), current);
  });

  it('rejects missing and malformed backups without changing active config', async (t) => {
    const directory = await temporaryDirectory(t);
    const configPath = join(directory, 'config.jsonc');
    const current = Buffer.from('{"safe":true}\n');
    await writeFile(configPath, current);
    const store = createStore(configPath);
    await writeFile(join(directory, 'config.jsonc.backup-1725000000123-bad'), '{');

    await assert.rejects(store.restore('outside-path'), MissingBackupError);
    await assert.rejects(store.restore('1725000000123-bad'), InvalidConfigError);
    assert.deepEqual(await readFile(configPath), current);
  });

  it('removes owned temporary files when injected backup publishing fails', async (t) => {
    const directory = await temporaryDirectory(t);
    const configPath = join(directory, 'config.jsonc');
    await writeFile(configPath, '{}');
    const store = createStore(configPath, {
      publish: async () => { throw Object.assign(new Error('injected failure'), { code: 'EIO' }); },
    });

    await assert.rejects(store.backup(), { code: 'EIO' });
    assert.deepEqual(await readdir(directory), ['config.jsonc']);
  });

  it('does not back up malformed active configuration before restore', async (t) => {
    const directory = await temporaryDirectory(t);
    const configPath = join(directory, 'config.jsonc');
    await writeFile(configPath, '{');
    await writeFile(join(directory, 'config.jsonc.backup-1725000000123-good'), '{"ok":true}');
    const store = createStore(configPath);

    await assert.rejects(store.restore('1725000000123-good'), InvalidConfigError);
    assert.deepEqual(await readdir(directory), [
      'config.jsonc', 'config.jsonc.backup-1725000000123-good',
    ]);
  });
});
