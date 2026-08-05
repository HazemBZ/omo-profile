/**
 * Portable filesystem contracts for profile-io.mjs.
 *
 * Every filesystem test uses an isolated temporary directory. The default path
 * policy is characterized without touching the user's OpenCode directory.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  atomicWrite,
  backupFile,
  configPath,
  ensureProfilesDir,
  filenameFromId,
  idFromFilename,
  listProfileFiles,
  profilePath,
  profilesDir,
  readJson,
} from './profile-io.mjs';

async function temporaryDirectory(t, prefix = 'omo-profile-io-') {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function withEnvironment(values, action) {
  const previous = new Map();
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await action();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

describe('profile-io path and naming contracts', () => {
  it('returns OpenCode defaults under homedir/.config/opencode', async () => {
    await withEnvironment({ OMO_CONFIG_PATH: undefined, OMO_PROFILES_DIR: undefined }, async () => {
      assert.equal(configPath(), join(homedir(), '.config', 'opencode', 'oh-my-openagent.json'));
      assert.equal(profilesDir(), join(homedir(), '.config', 'opencode', 'omo-profiles'));
    });
  });

  it('uses literal environment overrides and restores the caller environment', async () => {
    const config = '/tmp/path with spaces/配置.json';
    const profiles = '/tmp/profile space/配置';
    const beforeConfig = process.env.OMO_CONFIG_PATH;
    const beforeProfiles = process.env.OMO_PROFILES_DIR;

    await withEnvironment({ OMO_CONFIG_PATH: config, OMO_PROFILES_DIR: profiles }, async () => {
      assert.equal(configPath(), config);
      assert.equal(profilesDir(), profiles);
    });

    assert.equal(process.env.OMO_CONFIG_PATH, beforeConfig);
    assert.equal(process.env.OMO_PROFILES_DIR, beforeProfiles);
  });

  it('maps profile ids and lists only sorted JSON files', async (t) => {
    const directory = await temporaryDirectory(t);
    await writeFile(join(directory, 'zeta.json'), '{}');
    await writeFile(join(directory, 'alpha.json'), '{}');
    await writeFile(join(directory, 'notes.txt'), '{}');

    assert.equal(filenameFromId('space profile/配置'), 'space profile/配置.json');
    assert.equal(idFromFilename('space profile/配置.json'), 'space profile/配置');
    assert.deepEqual(listProfileFiles(directory), ['alpha.json', 'zeta.json']);
    assert.deepEqual(listProfileFiles(join(directory, 'missing')), []);
  });

  it('resolves profile paths without changing literal spaces or Unicode', async () => {
    const directory = '/tmp/profile space/配置';
    assert.equal(profilePath(directory, 'daily profile/配置'), join(directory, 'daily profile', '配置.json'));
  });

  it('reads JSON values from disk', async (t) => {
    const directory = await temporaryDirectory(t);
    const file = join(directory, 'profile.json');
    await writeFile(file, '{"name":"配置","enabled":true}\n');
    assert.deepEqual(await readJson(file), { name: '配置', enabled: true });
  });
});

describe('profile-io filesystem contracts', () => {
  it('creates nested profile directories recursively', async (t) => {
    const directory = await temporaryDirectory(t);
    const nested = join(directory, 'space dir', '配置', 'profiles');
    await ensureProfilesDir(nested);
    assert.deepEqual(await readdir(nested), []);
  });

  it('creates timestamped same-directory backups and preserves bytes', async (t) => {
    const directory = await temporaryDirectory(t);
    const source = join(directory, 'config space 配置.json');
    const content = '{"keep":"bytes"}\n';
    await writeFile(source, content);

    const backup = await backupFile(source);

    assert.match(backup, /\.bak-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
    assert.equal(backup.slice(0, -24), source);
    assert.equal(await readFile(backup, 'utf8'), content);
  });

  it('atomically writes absent and existing targets', async (t) => {
    const directory = await temporaryDirectory(t);
    const absent = join(directory, 'new profile 配置.json');
    const existing = join(directory, 'existing profile 配置.json');

    await atomicWrite(absent, 'first\n');
    assert.equal(await readFile(absent, 'utf8'), 'first\n');

    await writeFile(existing, 'old\n');
    await atomicWrite(existing, 'new\n');
    assert.equal(await readFile(existing, 'utf8'), 'new\n');
  });

  it('cleans same-directory temp files after a failed initial write', async (t) => {
    const directory = await temporaryDirectory(t);
    const target = join(directory, 'missing parent', 'profile.json');

    await assert.rejects(atomicWrite(target, 'data\n'), { code: 'ENOENT' });
    assert.deepEqual(await readdir(directory), []);
  });

  it('preserves target bytes and cleans temp after forced replacement failure', { skip: process.getuid?.() === 0 }, async (t) => {
    const directory = await temporaryDirectory(t);
    const readOnlyDirectory = join(directory, 'read only 配置');
    const target = join(readOnlyDirectory, 'existing profile.json');
    await mkdir(readOnlyDirectory);
    await writeFile(target, 'original bytes\n');
    await chmod(readOnlyDirectory, 0o555);

    try {
      await assert.rejects(atomicWrite(target, 'replacement bytes\n'), /EACCES|EPERM/);
    } finally {
      await chmod(readOnlyDirectory, 0o755);
    }

    assert.equal(await readFile(target, 'utf8'), 'original bytes\n');
    const leftovers = (await readdir(readOnlyDirectory)).filter(name => name.includes('.tmp.'));
    assert.deepEqual(leftovers, []);
  });
});
