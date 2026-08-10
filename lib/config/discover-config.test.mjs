/**
 * Portable discovery contracts for discover-config.mjs.
 *
 * Every filesystem test uses an isolated temporary directory. The injectable
 * { platform, env, home } context means no test ever touches the real machine.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONFIG_FILENAMES,
  ConfigNotFoundError,
  candidateConfigDirs,
  describeCheckedPaths,
  discoverConfig,
  getOpenCodeConfigDir,
} from './discover-config.mjs';

async function temporaryDirectory(t, prefix = 'omo-profile-config-') {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function makeConfigDir(home) {
  const configDir = join(home, '.config', 'opencode');
  await mkdir(configDir, { recursive: true });
  return configDir;
}

describe('discover-config filename priority', () => {
  it('finds a .jsonc config in the default directory', async (t) => {
    const home = await temporaryDirectory(t);
    const configDir = await makeConfigDir(home);
    await writeFile(join(configDir, 'oh-my-openagent.jsonc'), '{}');

    const result = discoverConfig({ platform: 'linux', env: {}, home });
    assert.deepEqual(result, {
      path: join(configDir, 'oh-my-openagent.jsonc'),
      format: 'jsonc',
      source: 'user',
    });
  });

  it('finds a .json config in the default directory', async (t) => {
    const home = await temporaryDirectory(t);
    const configDir = await makeConfigDir(home);
    await writeFile(join(configDir, 'oh-my-openagent.json'), '{}');

    const result = discoverConfig({ platform: 'linux', env: {}, home });
    assert.deepEqual(result, {
      path: join(configDir, 'oh-my-openagent.json'),
      format: 'json',
      source: 'user',
    });
  });

  it('prefers .jsonc over .json when both exist', async (t) => {
    const home = await temporaryDirectory(t);
    const configDir = await makeConfigDir(home);
    await writeFile(join(configDir, 'oh-my-openagent.json'), '{}');
    await writeFile(join(configDir, 'oh-my-openagent.jsonc'), '{}');

    const result = discoverConfig({ platform: 'linux', env: {}, home });
    assert.equal(result.path, join(configDir, 'oh-my-openagent.jsonc'));
    assert.equal(result.format, 'jsonc');
  });

  it('finds the legacy oh-my-opencode.json', async (t) => {
    const home = await temporaryDirectory(t);
    const configDir = await makeConfigDir(home);
    await writeFile(join(configDir, 'oh-my-opencode.json'), '{}');

    const result = discoverConfig({ platform: 'linux', env: {}, home });
    assert.deepEqual(result, {
      path: join(configDir, 'oh-my-opencode.json'),
      format: 'json',
      source: 'user',
    });
  });

  it('honours the full four-name priority order', async (t) => {
    const home = await temporaryDirectory(t);
    const configDir = await makeConfigDir(home);
    for (const name of CONFIG_FILENAMES) {
      await writeFile(join(configDir, name), '{}');
    }

    const result = discoverConfig({ platform: 'linux', env: {}, home });
    assert.equal(result.path, join(configDir, 'oh-my-openagent.jsonc'));
    assert.equal(result.format, 'jsonc');
  });
});

describe('discover-config platform defaults', () => {
  it('linux: resolves home/.config/opencode and discovers configs there', async (t) => {
    const home = await temporaryDirectory(t);
    const configDir = await makeConfigDir(home);
    await writeFile(join(configDir, 'oh-my-openagent.json'), '{}');

    assert.equal(getOpenCodeConfigDir({ platform: 'linux', env: {}, home }), configDir);
    assert.deepEqual(candidateConfigDirs({ platform: 'linux', env: {}, home }), [configDir]);

    const result = discoverConfig({ platform: 'linux', env: {}, home });
    assert.equal(result.path, join(configDir, 'oh-my-openagent.json'));
  });

  it('darwin: resolves home/.config/opencode and discovers configs there', async (t) => {
    const home = await temporaryDirectory(t);
    const configDir = await makeConfigDir(home);
    await writeFile(join(configDir, 'oh-my-openagent.json'), '{}');

    assert.equal(getOpenCodeConfigDir({ platform: 'darwin', env: {}, home }), configDir);
    assert.deepEqual(candidateConfigDirs({ platform: 'darwin', env: {}, home }), [configDir]);

    const result = discoverConfig({ platform: 'darwin', env: {}, home });
    assert.equal(result.path, join(configDir, 'oh-my-openagent.json'));
  });

  it('win32: uses APPDATA/opencode when APPDATA is set', async (t) => {
    const home = await temporaryDirectory(t);
    const appData = await temporaryDirectory(t);
    const configDir = join(appData, 'opencode');
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'oh-my-openagent.json'), '{}');

    const env = { APPDATA: appData };
    assert.equal(getOpenCodeConfigDir({ platform: 'win32', env, home }), configDir);
    assert.deepEqual(candidateConfigDirs({ platform: 'win32', env, home }), [
      configDir,
      join(home, '.config', 'opencode'),
    ]);

    const result = discoverConfig({ platform: 'win32', env, home });
    assert.equal(result.path, join(configDir, 'oh-my-openagent.json'));
  });

  it('win32: falls back to home/.config/opencode when APPDATA is unset', async (t) => {
    const home = await temporaryDirectory(t);
    const configDir = await makeConfigDir(home);
    await writeFile(join(configDir, 'oh-my-openagent.json'), '{}');

    const env = {};
    assert.equal(getOpenCodeConfigDir({ platform: 'win32', env, home }), configDir);
    assert.deepEqual(candidateConfigDirs({ platform: 'win32', env, home }), [configDir]);

    const result = discoverConfig({ platform: 'win32', env, home });
    assert.equal(result.path, join(configDir, 'oh-my-openagent.json'));
  });
});

describe('discover-config overrides', () => {
  it('OMO_CONFIG_DIR overrides platform defaults', async (t) => {
    const home = await temporaryDirectory(t);
    const overrideDir = await temporaryDirectory(t);
    await writeFile(join(overrideDir, 'oh-my-openagent.jsonc'), '{}');

    const env = { OMO_CONFIG_DIR: overrideDir, APPDATA: join(home, 'appdata') };
    assert.equal(getOpenCodeConfigDir({ platform: 'win32', env, home }), overrideDir);
    assert.deepEqual(candidateConfigDirs({ platform: 'win32', env, home }), [overrideDir]);

    const result = discoverConfig({ platform: 'win32', env, home });
    assert.equal(result.path, join(overrideDir, 'oh-my-openagent.jsonc'));
    assert.equal(result.format, 'jsonc');
  });

  it('OMO_CONFIG_PATH env override wins and maps .jsonc to jsonc format', async (t) => {
    const directory = await temporaryDirectory(t);
    const config = join(directory, 'custom 配置.jsonc');
    await writeFile(config, '{}');

    const result = discoverConfig({
      platform: 'linux',
      env: { OMO_CONFIG_PATH: config },
      home: join(directory, 'home'),
    });
    assert.deepEqual(result, { path: config, format: 'jsonc', source: 'env' });
  });

  it('explicitPath wins over discoverable files with source explicit', async (t) => {
    const home = await temporaryDirectory(t);
    const configDir = await makeConfigDir(home);
    await writeFile(join(configDir, 'oh-my-openagent.json'), '{}');

    const explicit = join(home, 'elsewhere', 'my config.json');
    await mkdir(join(home, 'elsewhere'), { recursive: true });
    await writeFile(explicit, '{}');

    const result = discoverConfig({ explicitPath: explicit, platform: 'linux', env: {}, home });
    assert.deepEqual(result, { path: explicit, format: 'json', source: 'explicit' });
  });

  it('ignores the OMO_CONFIG alias env var entirely', async (t) => {
    const home = await temporaryDirectory(t);
    const configDir = await makeConfigDir(home);
    await writeFile(join(configDir, 'oh-my-openagent.json'), '{}');

    const result = discoverConfig({
      platform: 'linux',
      env: { OMO_CONFIG: join(home, 'alias.json') },
      home,
    });
    assert.equal(result.path, join(configDir, 'oh-my-openagent.json'));
  });
});

describe('discover-config failure contracts', () => {
  it('throws ConfigNotFoundError listing every tried combination when nothing exists', async (t) => {
    const home = await temporaryDirectory(t);
    const appData = await temporaryDirectory(t);

    const env = { APPDATA: appData };
    const dirs = candidateConfigDirs({ platform: 'win32', env, home });
    const expectedChecked = [];
    for (const dir of dirs) {
      for (const name of CONFIG_FILENAMES) {
        expectedChecked.push(join(dir, name));
      }
    }

    assert.throws(
      () => discoverConfig({ platform: 'win32', env, home }),
      (err) => {
        assert.ok(err instanceof ConfigNotFoundError);
        assert.equal(err.message, 'No Oh My OpenAgent configuration found.');
        assert.deepEqual(err.checked, expectedChecked);
        assert.equal(
          describeCheckedPaths(err.checked),
          `Checked:\n${expectedChecked.map(path => `  ${path}`).join('\n')}`,
        );
        return true;
      },
    );
  });

  it('throws ConfigNotFoundError with checked=[explicitPath] when explicitPath is missing', async (t) => {
    const home = await temporaryDirectory(t);
    const missing = join(home, 'missing 配置.json');

    assert.throws(
      () => discoverConfig({ explicitPath: missing, platform: 'linux', env: {}, home }),
      (err) => {
        assert.ok(err instanceof ConfigNotFoundError);
        assert.equal(err.message, 'No Oh My OpenAgent configuration found.');
        assert.deepEqual(err.checked, [missing]);
        return true;
      },
    );
  });

  it('throws ConfigNotFoundError with checked=[path] when OMO_CONFIG_PATH is missing', async (t) => {
    const home = await temporaryDirectory(t);
    const missing = join(home, 'missing override.jsonc');

    assert.throws(
      () => discoverConfig({ platform: 'linux', env: { OMO_CONFIG_PATH: missing }, home }),
      (err) => {
        assert.ok(err instanceof ConfigNotFoundError);
        assert.deepEqual(err.checked, [missing]);
        return true;
      },
    );
  });

  it('renders Checked: (none) for an empty checked list', () => {
    assert.equal(describeCheckedPaths([]), 'Checked: (none)');
  });
});

describe('discover-config path fidelity', () => {
  it('preserves spaces and non-ASCII in discovered paths', async (t) => {
    const base = await temporaryDirectory(t);
    const spacedHome = join(base, 'home dir 配置');
    const configDir = join(spacedHome, '.config', 'opencode');
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'oh-my-openagent.json'), '{}');

    const result = discoverConfig({ platform: 'linux', env: {}, home: spacedHome });
    assert.equal(result.path, join(configDir, 'oh-my-openagent.json'));
  });

  it('preserves spaces and non-ASCII in explicit and env paths', async (t) => {
    const directory = await temporaryDirectory(t);
    const explicit = join(directory, 'my config 配置.jsonc');
    await writeFile(explicit, '{}');

    const fromExplicit = discoverConfig({ explicitPath: explicit, platform: 'linux', env: {}, home: directory });
    assert.equal(fromExplicit.path, explicit);

    const fromEnv = discoverConfig({ platform: 'linux', env: { OMO_CONFIG_PATH: explicit }, home: directory });
    assert.equal(fromEnv.path, explicit);
  });
});