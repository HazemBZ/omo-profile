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

let tmpDir, configPath, profilesDir, emptyBundleDir;

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

/**
 * Run the CLI with the real bundled profiles directory (package `profiles/`),
 * restoring the OMO_BUNDLED_PROFILES_DIR isolation override afterwards.
 */
function runCliWithDefaultBundle(args) {
  const previous = process.env.OMO_BUNDLED_PROFILES_DIR;
  delete process.env.OMO_BUNDLED_PROFILES_DIR;
  return runCli(args).finally(() => {
    if (previous === undefined) delete process.env.OMO_BUNDLED_PROFILES_DIR;
    else process.env.OMO_BUNDLED_PROFILES_DIR = previous;
  });
}

/**
 * Run the CLI without OMO_CONFIG_PATH in the child env, so the config
 * location can only come from OMO_CONFIG or discovery.
 */
function runCliNoConfigPath(args, env) {
  return new Promise((resolve, reject) => {
    const childEnv = {
      ...process.env,
      OMO_PROFILES_DIR: profilesDir,
      ...env,
    };
    delete childEnv.OMO_CONFIG_PATH;
    const child = execFile(
      process.execPath,
      [CLI, ...args],
      { env: childEnv },
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

const BUNDLED_IDS = ['deepseek-v4-flash-free', 'gpt56-light', 'gpt56-mixed', 'gpt56-xlight'];

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('agent-profile CLI (integration)', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omo-profile-int space-配置-'));
    configPath = join(tmpDir, 'oh-my openagent 配置.json');
    profilesDir = join(tmpDir, 'omo profiles 配置');
    mkdirSync(profilesDir, { recursive: true });
    // Isolate bundled-profile seeding: point the bundle source at an empty dir.
    emptyBundleDir = join(tmpDir, 'empty bundle 配置');
    mkdirSync(emptyBundleDir, { recursive: true });
    process.env.OMO_BUNDLED_PROFILES_DIR = emptyBundleDir;
    writeFileSync(configPath, JSON.stringify(fullValidConfig(), null, 2) + '\n');
  });

  afterEach(() => {
    delete process.env.OMO_BUNDLED_PROFILES_DIR;
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    tmpDir = undefined;
    configPath = undefined;
    profilesDir = undefined;
    emptyBundleDir = undefined;
  });

  // -----------------------------------------------------------------------
  // list
  // -----------------------------------------------------------------------
  it('list: no profiles → "No profiles found." with a save hint', async () => {
    const r = await runCli(['list']);
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes('No profiles found.'));
    assert.ok(r.stdout.includes('omo-profile save'), 'empty list shows a save hint');
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
  // bundled starter profiles
  // -----------------------------------------------------------------------
  it('list: seeds bundled starter profiles into the profiles directory', async () => {
    const r = await runCliWithDefaultBundle(['list']);
    assert.equal(r.exitCode, 0);
    for (const id of BUNDLED_IDS) {
      assert.ok(r.stdout.includes(id), `list must include bundled profile ${id}`);
      assert.ok(existsSync(join(profilesDir, `${id}.json`)), `${id} seeded to disk`);
    }
    assert.ok(!r.stdout.includes('[corrupt]'), 'seeded profiles parse cleanly');
  });

  it('list: bundled profiles never overwrite an existing profile of the same id', async () => {
    writeFileSync(
      join(profilesDir, 'gpt56-mixed.json'),
      JSON.stringify({ metadata: { name: 'mine' } }) + '\n',
    );
    const r = await runCliWithDefaultBundle(['list']);
    assert.equal(r.exitCode, 0);
    const raw = readFileSync(join(profilesDir, 'gpt56-mixed.json'), 'utf-8');
    assert.deepEqual(JSON.parse(raw).metadata, { name: 'mine' });
  });

  it('switch --dry-run: works against a bundled profile', async () => {
    const r = await runCliWithDefaultBundle(['switch', 'gpt56-mixed', '--dry-run']);
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes('[dry-run]'));
    assert.ok(r.stdout.includes('openai/gpt-5.6-sol'));
  });

  it('switch: applies a bundled profile and backs up the config', async () => {
    const r = await runCliWithDefaultBundle(['switch', 'gpt56-mixed']);
    assert.equal(r.exitCode, 0);
    const finalCfg = JSON.parse(readFileSync(configPath, 'utf-8'));
    assert.equal(finalCfg.agents.sisyphus.model, 'openai/gpt-5.6-sol');
    assert.equal(finalCfg.extraKey, 'should-survive');
    const backups = readdirSync(tmpDir).filter(f => f.startsWith(`${basename(configPath)}.bak-`));
    assert.ok(backups.length >= 1, 'switch created a backup');
  });

  it('current: identifies a bundled profile when the configuration matches', async () => {
    // fullValidConfig() assigns opencode/deepseek-v4-flash-free everywhere,
    // which is exactly the bundled deepseek-v4-flash-free profile.
    const r = await runCliWithDefaultBundle(['current']);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, 'Current profile: deepseek-v4-flash-free');
  });

  // -----------------------------------------------------------------------
  // current
  // -----------------------------------------------------------------------
  it('current: shows profile name when config matches', async () => {
    await runCli(['save', 'test-a']);
    const r = await runCli(['current']);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, 'Current profile: test-a');
  });

  it('current: shows "custom" when config does not match any profile', async () => {
    await runCli(['save', 'test-a']);
    // change the config slightly
    const cfg = fullValidConfig();
    cfg.agents.sisyphus.model = 'other/model';
    writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n');
    const r = await runCli(['current']);
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, 'Current configuration does not match a saved profile.');
  });

  it('current: shows "custom" when no profiles exist', async () => {
    // empty profiles dir
    const emptyProfiles = join(tmpDir, 'empty profiles 配置');
    mkdirSync(emptyProfiles, { recursive: true });
    const r = await runCli(['current'], { OMO_PROFILES_DIR: emptyProfiles });
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, 'Current configuration does not match a saved profile.');
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

  it('switch --dry-run: shows the canonical no-change diff', async () => {
    writeProfile('test-a');
    const r = await runCli(['switch', 'test-a', '--dry-run']);
    assert.ok(r.stdout.includes('[dry-run] Would switch to profile "test-a"'));
    assert.ok(r.stdout.includes('Profile "test-a": no changes.'));
    assert.ok(r.stdout.includes('No files were modified.'));
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
  // sparse / extensible profiles (P0)
  // -----------------------------------------------------------------------
  it('save→switch round-trip: preserves sparse entries and unknown fields', async () => {
    const sparseCfg = {
      $schema: 'https://example.com/schema.json',
      extraKey: 'should-survive',
      agents: {
        oracle: {
          model: 'openai/gpt-5.6-sol',
          temperature: 0.17,
          someFutureOption: { enabled: true },
        },
        'my-agent': { temperature: 0.2 },
      },
      categories: {
        git: { model: 'openai/gpt-5.4-mini' },
        'visual-engineering': { temperature: 0.1 },
      },
    };
    writeFileSync(configPath, JSON.stringify(sparseCfg, null, 2) + '\n');

    // save snapshots the sparse config as a profile
    const saveRes = await runCli(['save', 'sparse']);
    assert.equal(saveRes.exitCode, 0);

    // move the active config away from the profile
    writeFileSync(configPath, JSON.stringify(fullValidConfig(), null, 2) + '\n');

    // switch back
    const switchRes = await runCli(['switch', 'sparse']);
    assert.equal(switchRes.exitCode, 0, switchRes.stderr);

    // read the resulting config and compare against the input
    const finalCfg = JSON.parse(readFileSync(configPath, 'utf-8'));
    assert.deepEqual(finalCfg.agents, sparseCfg.agents,
      'agent entries survive round-trip byte-for-byte (unknown fields intact)');
    assert.deepEqual(finalCfg.categories, sparseCfg.categories,
      'category entries survive round-trip byte-for-byte');
    assert.equal(finalCfg.extraKey, 'should-survive');
    assert.equal(finalCfg.$schema, 'https://example.com/schema.json');

    // current must now identify the sparse profile
    const currentRes = await runCli(['current']);
    assert.equal(currentRes.exitCode, 0);
    assert.equal(currentRes.stdout, 'Current profile: sparse');
  });

  it('switch --dry-run: model-less entries use canonical no-change output', async () => {
    const sparseCfg = {
      $schema: 'https://example.com/schema.json',
      agents: { 'my-agent': { temperature: 0.2 } },
      categories: { git: { temperature: 0.1 } },
    };
    writeFileSync(configPath, JSON.stringify(sparseCfg, null, 2) + '\n');
    await runCli(['save', 'sparse-dry']);

    const r = await runCli(['switch', 'sparse-dry', '--dry-run']);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.ok(r.stdout.includes('Profile "sparse-dry": no changes.'), r.stdout);
    assert.ok(!r.stdout.includes('undefined'), 'no raw undefined in dry-run output');
  });

  it('switch: rejects a malformed known field in a sparse profile', async () => {
    writeFileSync(
      join(profilesDir, 'bad-known.json'),
      JSON.stringify({
        metadata: { name: 'bad-known' },
        agents: { oracle: { model: '' } },
      }) + '\n',
    );
    const r = await runCli(['switch', 'bad-known']);
    assert.notEqual(r.exitCode, 0);
    assert.ok(r.stderr.includes('invalid'));
    assert.ok(r.stderr.includes('.model must be a non-empty string'));
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
    writeFileSync(join(profilesDir, 'bad.json'), JSON.stringify({ agents: { oracle: 'nope' } }));
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

// ---------------------------------------------------------------------------
// JSONC configs, --config flag, and OMO_CONFIG alias (P1)
// ---------------------------------------------------------------------------

describe('agent-profile CLI — JSONC configs and --config (P1)', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omo-profile-p1 space-配置-'));
    configPath = join(tmpDir, 'oh-my openagent 配置.json');
    profilesDir = join(tmpDir, 'omo profiles 配置');
    mkdirSync(profilesDir, { recursive: true });
    // Isolate bundled-profile seeding: point the bundle source at an empty dir.
    emptyBundleDir = join(tmpDir, 'empty bundle 配置');
    mkdirSync(emptyBundleDir, { recursive: true });
    process.env.OMO_BUNDLED_PROFILES_DIR = emptyBundleDir;
    writeFileSync(configPath, JSON.stringify(fullValidConfig(), null, 2) + '\n');
  });

  afterEach(() => {
    delete process.env.OMO_BUNDLED_PROFILES_DIR;
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    tmpDir = undefined;
    configPath = undefined;
    profilesDir = undefined;
    emptyBundleDir = undefined;
  });

  it('JSONC end-to-end: save→switch preserves comments and trailing-comma config', async () => {
    const jsoncPath = join(tmpDir, 'jsonc 配置.jsonc');
    writeFileSync(jsoncPath, `// Top comment
{
  "$schema": "https://example.com/schema.json",
  "agents": {
    "oracle": {
      "model": "old/model",
    },
  },
  "categories": {},
}
`);

    const saveRes = await runCli(['save', 'jc'], { OMO_CONFIG_PATH: jsoncPath });
    assert.equal(saveRes.exitCode, 0, saveRes.stderr);

    // point the saved profile at a distinct model
    writeFileSync(
      join(profilesDir, 'jc.json'),
      JSON.stringify({
        metadata: { name: 'jc' },
        agents: { oracle: { model: 'new/model' } },
        categories: {},
      }, null, 2) + '\n',
    );

    const switchRes = await runCli(['switch', 'jc'], { OMO_CONFIG_PATH: jsoncPath });
    assert.equal(switchRes.exitCode, 0, switchRes.stderr);

    const final = readFileSync(jsoncPath, 'utf-8');
    assert.ok(final.includes('// Top comment'), 'top comment preserved');
    assert.ok(final.includes('"model": "new/model"'), 'new model written');
    assert.ok(!final.includes('old/model'), 'old model gone');

    const { parseJsonc } = await import('./config/jsonc.mjs');
    const { value: parsed } = parseJsonc(final);
    assert.equal(parsed.agents.oracle.model, 'new/model');
  });

  it('--config <path>: flag overrides OMO_CONFIG_PATH env', async () => {
    await runCli(['save', 'probe-a']);
    const aPath = join(tmpDir, 'a.json');
    const bPath = join(tmpDir, 'b.jsonc');
    writeFileSync(aPath, JSON.stringify(fullValidConfig(), null, 2) + '\n');
    const bCfg = fullValidConfig();
    bCfg.agents.sisyphus.model = 'other/model';
    writeFileSync(bPath, JSON.stringify(bCfg, null, 2) + '\n');

    const r = await runCli(['--config', aPath, 'current'], { OMO_CONFIG_PATH: bPath });
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.stdout, 'Current profile: probe-a');
  });

  it('--config=<path>: equals form works', async () => {
    await runCli(['save', 'probe-a']);
    const aPath = join(tmpDir, 'a.json');
    const bPath = join(tmpDir, 'b.jsonc');
    writeFileSync(aPath, JSON.stringify(fullValidConfig(), null, 2) + '\n');
    const bCfg = fullValidConfig();
    bCfg.agents.sisyphus.model = 'other/model';
    writeFileSync(bPath, JSON.stringify(bCfg, null, 2) + '\n');

    const r = await runCli([`--config=${aPath}`, 'current'], { OMO_CONFIG_PATH: bPath });
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.stdout, 'Current profile: probe-a');
  });

  it('--config after subcommand: switch applies to the flagged config', async () => {
    await runCli(['save', 'probe-a']);
    const aPath = join(tmpDir, 'a.json');
    const bPath = join(tmpDir, 'b.jsonc');
    const aCfg = fullValidConfig();
    aCfg.agents.sisyphus.model = 'other/model';
    writeFileSync(aPath, JSON.stringify(aCfg, null, 2) + '\n');
    const bCfg = fullValidConfig();
    bCfg.agents.oracle.model = 'other/model';
    writeFileSync(bPath, JSON.stringify(bCfg, null, 2) + '\n');

    const r = await runCli(['switch', 'probe-a', '--config', aPath], { OMO_CONFIG_PATH: bPath });
    assert.equal(r.exitCode, 0, r.stderr);
    const finalCfg = JSON.parse(readFileSync(aPath, 'utf-8'));
    assert.equal(finalCfg.agents.sisyphus.model, 'opencode/deepseek-v4-flash-free');
  });

  it('missing config: current exits 1 with "No Oh My OpenAgent configuration found." and "Checked:"', async () => {
    const missing = join(tmpDir, 'missing 配置.json');
    const r = await runCli(['current'], { OMO_CONFIG_PATH: missing });
    assert.equal(r.exitCode, 1);
    assert.ok(r.stderr.includes('No Oh My OpenAgent configuration found.'), r.stderr);
    assert.ok(r.stderr.includes('Checked:'), r.stderr);
  });

  it('malformed JSONC: current exits 1 with parse error and line info', async () => {
    const broken = join(tmpDir, 'broken 配置.jsonc');
    writeFileSync(broken, '{"agents": {');
    const r = await runCli(['current'], { OMO_CONFIG_PATH: broken });
    assert.equal(r.exitCode, 1);
    assert.ok(r.stderr.includes('Failed to parse OmO configuration'), r.stderr);
    assert.ok(r.stderr.includes('Line'), r.stderr);
  });

  it('OMO_CONFIG env alias: current reflects the aliased config file', async () => {
    await runCli(['save', 'alias-probe']);
    const aliasPath = join(tmpDir, 'alias 配置.jsonc');
    writeFileSync(aliasPath, `// alias config
${JSON.stringify(fullValidConfig(), null, 2)}
`);

    const r = await runCliNoConfigPath(['current'], { OMO_CONFIG: aliasPath });
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.stdout, 'Current profile: alias-probe');
});

// ---------------------------------------------------------------------------
// Canonical comparison and diff (P2)
// ---------------------------------------------------------------------------
describe('agent-profile CLI — canonical comparison and diff (P2)', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omo-profile-p2 space-配置-'));
    configPath = join(tmpDir, 'oh-my openagent 配置.json');
    profilesDir = join(tmpDir, 'omo profiles 配置');
    mkdirSync(profilesDir, { recursive: true });
    emptyBundleDir = join(tmpDir, 'empty bundle 配置');
    mkdirSync(emptyBundleDir, { recursive: true });
    process.env.OMO_BUNDLED_PROFILES_DIR = emptyBundleDir;
    writeFileSync(configPath, JSON.stringify({
      agents: {
        oracle: { model: 'old/model', temperature: 0.1 },
        explore: { model: 'unrelated/model' },
      },
      categories: { quick: { variant: 'low' } },
    }, null, 2) + '\n');
  });

  afterEach(() => {
    delete process.env.OMO_BUNDLED_PROFILES_DIR;
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('current: ignores unrelated entries but detects unknown managed-entry changes', async () => {
    writeFileSync(join(profilesDir, 'fast.json'), JSON.stringify({
      agents: { oracle: { model: 'old/model', temperature: 0.1 } },
      categories: { quick: { variant: 'low' } },
    }) + '\n');
    let result = await runCli(['current']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, 'Current profile: fast');

    const modified = JSON.parse(readFileSync(configPath, 'utf8'));
    modified.agents.oracle.temperature = 0.7;
    writeFileSync(configPath, JSON.stringify(modified, null, 2) + '\n');
    result = await runCli(['current']);
    assert.equal(result.stdout, 'Current configuration does not match a saved profile.');
  });

  it('current: reports every duplicate matching profile', async () => {
    const profile = { agents: { oracle: { model: 'old/model', temperature: 0.1 } } };
    writeFileSync(join(profilesDir, 'fast.json'), JSON.stringify(profile) + '\n');
    writeFileSync(join(profilesDir, 'work.json'), JSON.stringify(profile) + '\n');

    const result = await runCli(['current']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, 'Current configuration matches 2 profiles:\n  fast\n  work');
  });

  it('diff --json: reports structured switch changes including removals', async () => {
    writeFileSync(join(profilesDir, 'fast.json'), JSON.stringify({
      agents: { oracle: { model: 'new/model', temperature: 0.2 } },
      categories: {},
    }) + '\n');

    const result = await runCli(['diff', 'fast', '--json']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      profile: 'fast',
      changed: true,
      changes: [
        { path: 'agents.explore.model', type: 'removed', before: 'unrelated/model' },
        { path: 'agents.oracle.model', type: 'changed', before: 'old/model', after: 'new/model' },
        { path: 'agents.oracle.temperature', type: 'changed', before: 0.1, after: 0.2 },
        { path: 'categories.quick.variant', type: 'removed', before: 'low' },
      ],
    });
  });

  it('switch: defaults omitted profile sections to empty replacements', async () => {
    writeFileSync(join(profilesDir, 'agents-only.json'), JSON.stringify({
      agents: { oracle: { model: 'old/model', temperature: 0.1 } },
    }) + '\n');

    const result = await runCli(['switch', 'agents-only']);
    assert.equal(result.exitCode, 0, result.stderr);

    const finalConfig = JSON.parse(readFileSync(configPath, 'utf8'));
    assert.deepEqual(finalConfig.agents, { oracle: { model: 'old/model', temperature: 0.1 } });
    assert.deepEqual(finalConfig.categories, {});
  });

  it('switch --dry-run: renders same diff and does not change config', async () => {
    writeFileSync(join(profilesDir, 'fast.json'), JSON.stringify({
      agents: { oracle: { model: 'new/model', temperature: 0.2 } },
      categories: {},
    }) + '\n');
    const before = readFileSync(configPath, 'utf8');
    const diff = await runCli(['diff', 'fast']);
    const result = await runCli(['switch', 'fast', '--dry-run']);

    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.includes('[dry-run] Would switch to profile "fast"'));
    assert.ok(result.stdout.includes('agents.oracle'));
    assert.ok(result.stdout.includes('old/model → new/model'));
    assert.ok(result.stdout.includes('No files were modified.'));
    assert.ok(diff.stdout.includes('4 changes'));
    assert.equal(readFileSync(configPath, 'utf8'), before);
  });

  it('switch --dry-run: does not seed bundled profiles into an existing directory', async () => {
    writeFileSync(join(profilesDir, 'fast.json'), JSON.stringify({
      agents: { oracle: { model: 'old/model', temperature: 0.1 } },
      categories: { quick: { variant: 'low' } },
    }) + '\n');
    const before = readdirSync(profilesDir);

    const result = await runCliWithDefaultBundle(['switch', 'fast', '--dry-run']);

    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(readdirSync(profilesDir), before);
  });

  it('diff: preserves missing and null sections so records predict switch writes', async () => {
    const profile = {
      agents: { oracle: { model: 'new/model' } },
      categories: { quick: { variant: 'high' } },
    };
    writeFileSync(join(profilesDir, 'fast.json'), JSON.stringify(profile) + '\n');

    writeFileSync(configPath, '{}\n');
    let result = await runCli(['diff', 'fast', '--json']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).changes, [
      { path: 'agents.oracle.model', type: 'added', after: 'new/model' },
      { path: 'categories.quick.variant', type: 'added', after: 'high' },
    ]);

    writeFileSync(configPath, JSON.stringify({ agents: null, categories: null }) + '\n');
    result = await runCli(['diff', 'fast', '--json']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).changes, [
      { path: 'agents', type: 'changed', before: null, after: profile.agents },
      { path: 'categories', type: 'changed', before: null, after: profile.categories },
    ]);

    const switched = await runCli(['switch', 'fast']);
    assert.equal(switched.exitCode, 0, switched.stderr);
    const finalConfig = JSON.parse(readFileSync(configPath, 'utf8'));
    assert.deepEqual(finalConfig.agents, profile.agents);
    assert.deepEqual(finalConfig.categories, profile.categories);
  });
});
});
