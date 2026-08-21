import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runDoctor } from './run-doctor.mjs';
import { checkPermissions } from './checks/permissions.mjs';
import { OpencodeNotFoundError } from '../opencode/models.mjs';

const NOW = 1755555555555;

function findCheck(report, id) {
  return report.checks.find((c) => c.id === id);
}

function validConfig() {
  return {
    $schema: 'https://example.com/schema.json',
    extraKey: 'should-survive',
    agents: { oracle: { model: 'provider/a', variant: 'default', fallback_models: [] } },
    categories: { deep: { model: 'provider/b', variant: 'default', fallback_models: [] } },
  };
}

function profileDoc(id) {
  return {
    metadata: { name: id, created: '2026-01-01T00:00:00.000Z' },
    agents: { oracle: { model: 'provider/a', variant: 'default', fallback_models: [] } },
    categories: { deep: { model: 'provider/b', variant: 'default', fallback_models: [] } },
  };
}

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'omo-doctor-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const configPath = join(dir, 'oh-my-openagent.json');
  const profilesDir = join(dir, 'profiles');
  mkdirSync(profilesDir);
  return { dir, configPath, profilesDir };
}

describe('runDoctor', () => {
  it('reports a healthy environment', async (t) => {
    const { configPath, profilesDir } = setup(t);
    writeFileSync(configPath, JSON.stringify(validConfig(), null, 2) + '\n');
    writeFileSync(join(profilesDir, 'work.json'), JSON.stringify(profileDoc('work'), null, 2) + '\n');

    const report = await runDoctor({
      explicitConfig: configPath,
      profilesDir,
      getAvailableModels: async () => ['provider/a', 'provider/b'],
      now: () => NOW,
    });

    assert.equal(report.healthy, true);
    assert.equal(report.summary.fail, 0);
    assert.equal(findCheck(report, 'config.found').status, 'pass');
    assert.equal(findCheck(report, 'config.parse').status, 'pass');
    assert.equal(findCheck(report, 'config.validate').status, 'pass');
    assert.equal(findCheck(report, 'profiles.count').status, 'pass');
    assert.equal(findCheck(report, 'profiles.valid').status, 'pass');
    assert.equal(findCheck(report, 'active-profile').status, 'pass');
    assert.equal(findCheck(report, 'duplicates').status, 'pass');
    assert.equal(findCheck(report, 'models.collected').status, 'pass');
    assert.equal(findCheck(report, 'models.availability').status, 'pass');
    assert.equal(findCheck(report, 'storage.profiles').status, 'pass');
    assert.equal(findCheck(report, 'storage.config').status, 'pass');
    assert.equal(findCheck(report, 'storage.atomic').status, 'pass');
    assert.equal(findCheck(report, 'backups.count').status, 'pass');
    assert.equal(findCheck(report, 'backups.temp').status, 'pass');
    assert.equal(findCheck(report, 'lock.state').status, 'pass');
  });

  it('fails on missing config but does not crash', async (t) => {
    const { dir, profilesDir } = setup(t);
    const missing = join(dir, 'does-not-exist.json');

    const report = await runDoctor({
      explicitConfig: missing,
      profilesDir,
      offline: true,
      now: () => NOW,
    });

    assert.equal(report.healthy, false);
    assert.equal(findCheck(report, 'config.found').status, 'fail');
    assert.equal(findCheck(report, 'config.parse').status, 'skip');
    assert.equal(findCheck(report, 'config.validate').status, 'skip');
    assert.equal(findCheck(report, 'storage.config').status, 'skip');
    assert.equal(findCheck(report, 'storage.atomic').status, 'skip');
    assert.equal(findCheck(report, 'backups.count').status, 'skip');
    // Unrelated checks still ran.
    assert.equal(findCheck(report, 'lock.state').status, 'pass');
  });

  it('fails on broken config parsing', async (t) => {
    const { configPath, profilesDir } = setup(t);
    writeFileSync(configPath, '{"agents": {"oracle": {"model": "x"');

    const report = await runDoctor({
      explicitConfig: configPath,
      profilesDir,
      offline: true,
      now: () => NOW,
    });

    assert.equal(report.healthy, false);
    assert.equal(findCheck(report, 'config.found').status, 'pass');
    assert.equal(findCheck(report, 'config.parse').status, 'fail');
    assert.equal(findCheck(report, 'config.validate').status, 'skip');
  });

  it('fails on an invalid saved profile but keeps checking', async (t) => {
    const { configPath, profilesDir } = setup(t);
    writeFileSync(configPath, JSON.stringify(validConfig(), null, 2) + '\n');
    writeFileSync(
      join(profilesDir, 'legacy.json'),
      JSON.stringify({ metadata: {}, agents: { oracle: { model: 123 } } }, null, 2) + '\n',
    );

    const report = await runDoctor({
      explicitConfig: configPath,
      profilesDir,
      offline: true,
      now: () => NOW,
    });

    assert.equal(report.healthy, false);
    assert.equal(findCheck(report, 'profiles.count').status, 'pass');
    const invalid = findCheck(report, 'profiles.invalid');
    assert.equal(invalid.status, 'fail');
    assert.ok(invalid.message.includes('legacy'));
    // Other checks unaffected.
    assert.equal(findCheck(report, 'config.validate').status, 'pass');
  });

  it('warns on duplicate profiles', async (t) => {
    const { configPath, profilesDir } = setup(t);
    writeFileSync(configPath, JSON.stringify(validConfig(), null, 2) + '\n');
    const doc = JSON.stringify(profileDoc('same'), null, 2) + '\n';
    writeFileSync(join(profilesDir, 'a.json'), doc);
    writeFileSync(join(profilesDir, 'b.json'), doc);

    const report = await runDoctor({
      explicitConfig: configPath,
      profilesDir,
      offline: true,
      now: () => NOW,
    });

    assert.equal(report.healthy, true); // warning only
    const dup = findCheck(report, 'duplicates');
    assert.equal(dup.status, 'warn');
  });

  it('warns on a model not reported by OpenCode', async (t) => {
    const { configPath, profilesDir } = setup(t);
    const cfg = validConfig();
    cfg.agents.oracle.model = 'provider/old';
    writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n');

    const report = await runDoctor({
      explicitConfig: configPath,
      profilesDir,
      getAvailableModels: async () => ['provider/a', 'provider/b'],
      now: () => NOW,
    });

    assert.equal(report.healthy, true); // warning only
    const check = findCheck(report, 'model.available');
    assert.equal(check.status, 'warn');
    assert.equal(check.model, 'provider/old');
    assert.ok(check.details.includes('referenced by:'));
  });

  it('warns when opencode is missing and skips availability', async (t) => {
    const { configPath, profilesDir } = setup(t);
    writeFileSync(configPath, JSON.stringify(validConfig(), null, 2) + '\n');

    const report = await runDoctor({
      explicitConfig: configPath,
      profilesDir,
      getAvailableModels: async () => {
        throw new OpencodeNotFoundError('opencode');
      },
      now: () => NOW,
    });

    assert.equal(report.healthy, true);
    const check = findCheck(report, 'models.opencode');
    assert.equal(check.status, 'warn');
    assert.ok(check.message.includes('opencode'));
  });

  it('skips model availability with --offline', async (t) => {
    const { configPath, profilesDir } = setup(t);
    writeFileSync(configPath, JSON.stringify(validConfig(), null, 2) + '\n');

    const report = await runDoctor({
      explicitConfig: configPath,
      profilesDir,
      offline: true,
      now: () => NOW,
    });

    const check = findCheck(report, 'models.availability');
    assert.equal(check.status, 'skip');
    assert.ok(check.message.includes('--offline'));
  });

  it('detects an active lock', async (t) => {
    const { configPath, profilesDir } = setup(t);
    writeFileSync(configPath, JSON.stringify(validConfig(), null, 2) + '\n');
    writeFileSync(
      join(profilesDir, '.omo-profile.lock'),
      JSON.stringify({ pid: 12345, createdAt: NOW, token: 'tok' }),
    );

    const report = await runDoctor({
      explicitConfig: configPath,
      profilesDir,
      offline: true,
      now: () => NOW,
      isProcessAlive: () => true,
    });

    const check = findCheck(report, 'lock.state');
    assert.equal(check.status, 'warn');
    assert.ok(check.details.some((d) => d.includes('PID: 12345')));
  });

  it('detects a stale lock', async (t) => {
    const { configPath, profilesDir } = setup(t);
    writeFileSync(configPath, JSON.stringify(validConfig(), null, 2) + '\n');
    writeFileSync(
      join(profilesDir, '.omo-profile.lock'),
      JSON.stringify({ pid: 999999, createdAt: NOW - 10 * 60 * 1000, token: 'tok' }),
    );

    const report = await runDoctor({
      explicitConfig: configPath,
      profilesDir,
      offline: true,
      now: () => NOW,
      isProcessAlive: () => false,
    });

    const check = findCheck(report, 'lock.state');
    assert.equal(check.status, 'warn');
    assert.equal(check.stale, true);
  });

  it('warns on too many backups', async (t) => {
    const { dir, configPath, profilesDir } = setup(t);
    writeFileSync(configPath, JSON.stringify(validConfig(), null, 2) + '\n');
    const configName = 'oh-my-openagent.json';
    for (let i = 0; i < 3; i += 1) {
      writeFileSync(join(dir, `${configName}.backup-175555555555${i}-aaaa`), '{}');
    }

    const report = await runDoctor({
      explicitConfig: configPath,
      profilesDir,
      offline: true,
      now: () => NOW,
      maxBackups: 2,
    });

    const check = findCheck(report, 'backups.count');
    assert.equal(check.status, 'warn');
    assert.ok(check.message.includes('3 backups found'));
  });

  it('reports one broken check without stopping unrelated checks', async (t) => {
    const { configPath, profilesDir } = setup(t);
    const cfg = validConfig();
    cfg.agents.oracle.model = 'provider/old';
    writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n');
    writeFileSync(
      join(profilesDir, 'legacy.json'),
      JSON.stringify({ metadata: {}, agents: { oracle: { model: 123 } } }, null, 2) + '\n',
    );

    const report = await runDoctor({
      explicitConfig: configPath,
      profilesDir,
      getAvailableModels: async () => ['provider/a'],
      now: () => NOW,
    });

    assert.equal(findCheck(report, 'config.found').status, 'pass');
    assert.equal(findCheck(report, 'config.validate').status, 'pass');
    assert.equal(findCheck(report, 'profiles.invalid').status, 'fail');
    assert.equal(findCheck(report, 'model.available').status, 'warn');
    assert.equal(report.healthy, false);
  });
});

describe('checkPermissions (injectable)', () => {
  const ctx = {
    profilesDir: '/profiles',
    discovery: { path: '/config/oh-my-openagent.json' },
    configDir: '/config',
  };

  it('fails when profile directory is not writable', async () => {
    const deps = {
      stat: async (p) => ({ isDirectory: () => p === '/profiles' }),
      access: async (p, mode) => {
        if (p === '/profiles' && mode === constants.W_OK) {
          const e = new Error('EACCES');
          e.code = 'EACCES';
          throw e;
        }
      },
    };

    const results = await checkPermissions(ctx, deps);
    const check = results.find((c) => c.id === 'storage.profiles');
    assert.equal(check.status, 'fail');
    assert.ok(check.message.includes('not writable'));
  });

  it('fails when config directory is not writable', async () => {
    const deps = {
      stat: async (p) => ({ isDirectory: () => p === '/profiles' }),
      access: async (p, mode) => {
        if (p === '/config' && mode === constants.W_OK) {
          const e = new Error('EACCES');
          e.code = 'EACCES';
          throw e;
        }
      },
    };

    const results = await checkPermissions(ctx, deps);
    const check = results.find((c) => c.id === 'storage.atomic');
    assert.equal(check.status, 'fail');
    assert.ok(check.message.includes('Atomic writes not supported'));
  });
});
