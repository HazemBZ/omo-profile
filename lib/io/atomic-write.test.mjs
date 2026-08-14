import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWrite } from './atomic-write.mjs';

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'omo-atomic-write-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

describe('atomicWrite', () => {
  it('preserves existing target mode while atomically replacing bytes', async (t) => {
    const directory = await temporaryDirectory(t);
    const target = join(directory, 'config.jsonc');
    await writeFile(target, 'old\n', { mode: 0o640 });

    await atomicWrite(target, 'new\n');

    assert.equal(await readFile(target, 'utf8'), 'new\n');
    if (process.platform !== 'win32') {
      assert.equal((await lstat(target)).mode & 0o777, 0o640);
    }
  });

  it('preserves target and removes only owned temp when writing fails', async (t) => {
    const directory = await temporaryDirectory(t);
    const target = join(directory, 'config.jsonc');
    await writeFile(target, 'original\n');
    const foreign = join(directory, '.config.jsonc.tmp.foreign');
    await writeFile(foreign, 'foreign');

    await assert.rejects(
      atomicWrite(target, 'replacement\n', {
        write: async () => { throw Object.assign(new Error('write failed'), { code: 'EIO' }); },
      }),
      { code: 'EIO' },
    );

    assert.equal(await readFile(target, 'utf8'), 'original\n');
    assert.deepEqual(await readdir(directory), ['.config.jsonc.tmp.foreign', 'config.jsonc']);
  });

  it('preserves target and removes owned temp when rename fails', async (t) => {
    const directory = await temporaryDirectory(t);
    const target = join(directory, 'config.jsonc');
    await writeFile(target, 'original\n');

    await assert.rejects(
      atomicWrite(target, 'replacement\n', {
        rename: async () => { throw Object.assign(new Error('rename failed'), { code: 'EIO' }); },
      }),
      { code: 'EIO' },
    );

    assert.equal(await readFile(target, 'utf8'), 'original\n');
    assert.deepEqual(await readdir(directory), ['config.jsonc']);
  });

  it('preserves a fixed-suffix collision temp it did not create', async (t) => {
    const directory = await temporaryDirectory(t);
    const target = join(directory, 'config.jsonc');
    const foreign = join(directory, '.config.jsonc.tmp.fixed');
    await writeFile(target, 'original\n');
    await writeFile(foreign, 'foreign bytes\n');

    await assert.rejects(
      atomicWrite(target, 'replacement\n', { randomSuffix: () => 'fixed' }),
      { code: 'EEXIST' },
    );

    assert.equal(await readFile(target, 'utf8'), 'original\n');
    assert.equal(await readFile(foreign, 'utf8'), 'foreign bytes\n');
  });
});
