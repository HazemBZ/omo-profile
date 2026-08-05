/**
 * Integration tests for agent-profile.mjs
 *
 * Exercises the full CLI against temporary config / profile directories
 * so the real active config is never touched.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLI = fileURLToPath(new URL('../agent-profile.mjs', import.meta.url));

function fullValidConfig() {
  const agents = [
    'hephaestus','oracle','librarian','explore','multimodal-looker',
    'prometheus','metis','momus','atlas','sisyphus-junior','sisyphus',
  ];
  const categories = [
    'visual-engineering','ultrabrain','deep','artistry',
    'quick','unspecified-low','unspecified-high','writing',
  ];
  const entry = { model: 'opencode/deepseek-v4-flash-free', variant: 'default', fallback_models: [] };
  const cfg = { $schema: 'https://example.com/schema.json', extraKey: 'should-survive', agents: {}, categories: {} };
  for (const a of agents) cfg.agents[a] = { ...entry };
  for (const c of categories) cfg.categories[c] = { ...entry };
  return cfg;
}

let tmpDir, configPath, profilesDir;

function writeProfile(id, cfg = fullValidConfig()) {
  const profileData = {
    metadata: { name: id, created: new Date().toISOString() },
    agents: cfg.agents,
    categories: cfg.categories,
  };
  writeFileSync(join(profilesDir, `${id}.json`), JSON.stringify(profileData, null, 2) + '\n');
}

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [CLI, ...args],
      {
        env: {
          ...process.env,
          OMO_CONFIG_PATH: configPath,
          OMO_PROFILES_DIR: profilesDir,
          ...env,
        },
      },
      (err, stdout, stderr) => {
        resolve({
          exitCode: err ? (err.code ?? 1) : 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('agent-profile CLI (integration)', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omo-profile-int space-配置-'));
    configPath = join(tmpDir, 'oh-my openagent 配置.json');
    profilesDir = join(tmpDir, 'omo profiles 配置');
    mkdirSync(profilesDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify(fullValidConfig(), null, 2) + '\n');
  });

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    tmpDir = undefined;
    configPath = undefined;
    profilesDir = undefined;
  });

  // -----------------------------------------------------------------------
  // list
  // -----------------------------------------------------------------------
  it('list: no profiles → "No profiles found."', async () => {
    const r = await runCli(['list']);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, 'No profiles found.');
  });

  it('list --json: no profiles → {"profiles":[]}', async () => {
    const r = await runCli(['list', '--json']);
    assert.equal(r.exitCode, 0);
    assert.deepEqual(JSON.parse(r.stdout), { profiles: [] });
  });

  it('list: after saving a profile', async () => {
    // save first
    await runCli(['save', 'test-a']);
    const r = await runCli(['list']);
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes('test-a'));
    assert.ok(!r.stdout.includes('[corrupt]'));
  });

  it('list --json: returns metadata', async () => {
    await runCli(['save', 'test-a']);
    const r = await runCli(['list', '--json']);
    assert.equal(r.exitCode, 0);
    const parsed = JSON.parse(r.stdout);
    assert.ok(Array.isArray(parsed.profiles));
    const found = parsed.profiles.find(p => p.id === 'test-a');
    assert.ok(found);
    assert.equal(found.name, 'test-a');
    assert.ok(found.created);
  });

  it('list: corrupt profile marked [corrupt]', async () => {
    await runCli(['save', 'test-a']);
    writeFileSync(join(profilesDir, 'corrupt.json'), '{not json');
    const r = await runCli(['list']);
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes('corrupt'), 'corrupt flag in output');
    assert.ok(r.stdout.includes('test-a'), 'valid profile still listed');
  });

  // -----------------------------------------------------------------------
  // current
  // -----------------------------------------------------------------------
  it('current: shows profile name when config matches', async () => {
    await runCli(['save', 'test-a']);
    const r = await runCli(['current']);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, 'test-a');
  });

  it('current: shows "custom" when config does not match any profile', async () => {
    await runCli(['save', 'test-a']);
    // change the config slightly
    const cfg = fullValidConfig();
    cfg.agents.sisyphus.model = 'other/model';
    writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n');
    const r = await runCli(['current']);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, 'custom');
  });

  it('current: shows "custom" when no profiles exist', async () => {
    // empty profiles dir
    const emptyProfiles = join(tmpDir, 'empty profiles 配置');
    mkdirSync(emptyProfiles, { recursive: true });
    const r = await runCli(['current'], { OMO_PROFILES_DIR: emptyProfiles });
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, 'custom');
  });

  // -----------------------------------------------------------------------
  // save
  // -----------------------------------------------------------------------
  it('save: persists a profile file', async () => {
    const r = await runCli(['save', 'test-b']);
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes('test-b'));
    const saved = readFileSync(join(profilesDir, 'test-b.json'), 'utf-8');
    const parsed = JSON.parse(saved);
    assert.ok(parsed.agents);
    assert.ok(parsed.categories);
    assert.equal(parsed.metadata.name, 'test-b');
  });

  it('save: rejects empty id', async () => {
    const r = await runCli(['save', '']);
    assert.notEqual(r.exitCode, 0);
  });

  it('save: rejects id with special chars', async () => {
    const r = await runCli(['save', '../escape']);
    assert.notEqual(r.exitCode, 0);
  });

  // -----------------------------------------------------------------------
  // switch --dry-run
  // -----------------------------------------------------------------------
  it('switch --dry-run: does not modify config', async () => {
    // restore the matching config
    writeFileSync(configPath, JSON.stringify(fullValidConfig(), null, 2) + '\n');
    writeProfile('test-a');
    const beforeContent = readFileSync(configPath, 'utf-8');

    const r = await runCli(['switch', 'test-a', '--dry-run']);
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes('[dry-run]'));

    // verify config untouched
    const afterContent = readFileSync(configPath, 'utf-8');
    assert.equal(beforeContent, afterContent);
  });

  it('switch --dry-run: shows agent and category assignments', async () => {
    writeProfile('test-a');
    const r = await runCli(['switch', 'test-a', '--dry-run']);
    assert.ok(r.stdout.includes('Agent assignments'));
    assert.ok(r.stdout.includes('Category assignments'));
    assert.ok(r.stdout.includes('opencode/deepseek-v4-flash-free'));
  });

  // -----------------------------------------------------------------------
  // switch (real)
  // -----------------------------------------------------------------------
  it('switch: applies profile with atomic write and preserves top-level keys', async () => {
    // Start from a config with a different model and a top-level extraKey
    const baseCfg = fullValidConfig();
    baseCfg.agents.sisyphus.model = 'other/model';
    baseCfg.extraKey = 'should-survive';
    writeFileSync(configPath, JSON.stringify(baseCfg, null, 2) + '\n');

    // Save a fresh profile "target-profile" with deepseek
    const targetCfg = fullValidConfig();
    // Write the profile directly
    writeProfile('target-profile', targetCfg);

    const r = await runCli(['switch', 'target-profile']);
    assert.equal(r.exitCode, 0);

    // Check backup exists
    const files = readdirSync(tmpDir);
    const backups = files.filter(f => f.startsWith(`${basename(configPath)}.bak-`));
    assert.ok(backups.length >= 1, `expected backup, found: ${files.join(', ')}`);

    // verify config was updated
    const finalCfg = JSON.parse(readFileSync(configPath, 'utf-8'));
    assert.equal(finalCfg.agents.sisyphus.model, 'opencode/deepseek-v4-flash-free');
    // top-level keys preserved
    assert.equal(finalCfg.extraKey, 'should-survive');
    // $schema preserved
    assert.equal(finalCfg.$schema, 'https://example.com/schema.json');

    // (backup already verified above via readdirSync)
  });

  // -----------------------------------------------------------------------
  // switch errors
  // -----------------------------------------------------------------------
  it('switch ../escape: exits 1 before reading outside profiles dir', async () => {
    const beforeContent = readFileSync(configPath, 'utf-8');
    const r = await runCli(['switch', '../escape']);
    assert.notEqual(r.exitCode, 0);
    // Must match the same message as save, not "not found"
    assert.ok(r.stderr.includes('alphanumeric'), `stderr: ${r.stderr}`);
    // Config must not be mutated
    assert.equal(readFileSync(configPath, 'utf-8'), beforeContent);
  });

  it('switch nonexistent: exits 1 with error message', async () => {
    const r = await runCli(['switch', 'no-such-profile']);
    assert.notEqual(r.exitCode, 0);
    assert.ok(r.stderr.includes('not found'));
  });

  it('switch with invalid profile: exits 1', async () => {
    writeFileSync(join(profilesDir, 'bad.json'), JSON.stringify({ agents: {} }));
    const r = await runCli(['switch', 'bad']);
    assert.notEqual(r.exitCode, 0);
    assert.ok(r.stderr.includes('invalid'));
  });

  // -----------------------------------------------------------------------
  // help
  // -----------------------------------------------------------------------
  it('help: shows usage', async () => {
    const r = await runCli(['help']);
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes('Usage:'));
  });

  it('no args: shows usage', async () => {
    const r = await runCli([]);
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes('Usage:'));
  });

  it('--help: shows usage', async () => {
    const r = await runCli(['--help']);
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes('Usage:'));
  });

  // -----------------------------------------------------------------------
  // unknown command
  // -----------------------------------------------------------------------
  it('unknown command: exits 1', async () => {
    const r = await runCli(['blarg']);
    assert.notEqual(r.exitCode, 0);
    assert.ok(r.stderr.includes('Unknown command'));
  });
});
