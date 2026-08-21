import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runDoctor } from './run-doctor.mjs';
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

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'omo-doctor-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const configPath = join(dir, 'oh-my-openagent.json');
  const profilesDir = join(dir, 'profiles');
  mkdirSync(profilesDir);
  return { dir, configPath, profilesDir };
}

describe('runDoctor model availability', () => {
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
});
