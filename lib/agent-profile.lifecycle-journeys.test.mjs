/**
 * Narrative lifecycle journeys (P3 Task 7).
 *
 * Each test tells one end-to-end story across the profile / config lifecycle,
 * driving the real CLI against temporary fixtures (never the user's config).
 * Resilience stories (d) and (e) prove that a failed or racing mutation still
 * leaves a recoverable backup / a released lock.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigStore } from './config/config-store.mjs';

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

function readConfig() {
  return JSON.parse(readFileSync(configPath, 'utf8'));
}

function runCli(args, env) {
  return new Promise(resolve => {
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

describe('agent-profile lifecycle journeys (P3)', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omo-profile-journey space-配置-'));
    configPath = join(tmpDir, 'oh-my openagent 配置.json');
    profilesDir = join(tmpDir, 'omo profiles 配置');
    mkdirSync(profilesDir, { recursive: true });
    const emptyBundleDir = join(tmpDir, 'empty bundle 配置');
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
  });

  // -----------------------------------------------------------------------
  // (a) save → clone → rename → list → delete
  // -----------------------------------------------------------------------
  it('journey (a): save → clone → rename → list → delete leaves only the origin', async () => {
    // Given: a snapshot of the active config
    const saved = await runCli(['save', 'journey-origin']);
    assert.equal(saved.exitCode, 0, saved.stderr);

    // When: cloning and then renaming the saved profile
    const cloned = await runCli(['clone', 'journey-origin', 'journey-clone', '--json']);
    const renamed = await runCli(['rename', 'journey-clone', 'journey-final', '--json']);

    // Then: origin survives and the clone becomes the renamed profile
    assert.deepEqual(JSON.parse(cloned.stdout), { ok: true, sourceId: 'journey-origin', profileId: 'journey-clone' });
    assert.deepEqual(JSON.parse(renamed.stdout), { ok: true, oldId: 'journey-clone', profileId: 'journey-final' });

    // When: listing the profiles
    const listed = await runCli(['list', '--json']);

    // Then: origin and final are present, the intermediate clone is gone
    const ids = JSON.parse(listed.stdout).profiles.map(profile => profile.id);
    assert.ok(ids.includes('journey-origin'));
    assert.ok(ids.includes('journey-final'));
    assert.ok(!ids.includes('journey-clone'));

    // When: deleting the final profile
    const deleted = await runCli(['delete', 'journey-final', '--yes', '--json']);

    // Then: deletion is confirmed and only the origin remains on disk
    assert.deepEqual(JSON.parse(deleted.stdout), { ok: true, profileId: 'journey-final' });
    assert.equal(existsSync(join(profilesDir, 'journey-final.json')), false);
    assert.ok(existsSync(join(profilesDir, 'journey-origin.json')));
  });

  // -----------------------------------------------------------------------
  // (b) switch A → switch B → backups → restore A
  // -----------------------------------------------------------------------
  it('journey (b): switch A → switch B → backups → restore A returns to A', async () => {
    // Given: two distinct profiles with different models
    const a = fullValidConfig();
    a.agents.sisyphus.model = 'a/model';
    writeProfile('journey-a', a);
    const b = fullValidConfig();
    b.agents.sisyphus.model = 'b/model';
    writeProfile('journey-b', b);

    // When: switching to A then B, each publishing a pre-mutation backup
    const switchedA = await runCli(['switch', 'journey-a']);
    assert.equal(switchedA.exitCode, 0, switchedA.stderr);
    assert.equal(readConfig().agents.sisyphus.model, 'a/model');
    const switchedB = await runCli(['switch', 'journey-b']);
    assert.equal(switchedB.exitCode, 0, switchedB.stderr);
    assert.equal(readConfig().agents.sisyphus.model, 'b/model');

    // Then: exactly two newest-first backups exist
    const listed = await runCli(['backups', '--json']);
    assert.equal(listed.exitCode, 0, listed.stderr);
    assert.equal(listed.stderr, '');
    const backups = JSON.parse(listed.stdout).backups;
    assert.equal(backups.length, 2);

    // When: restoring the backup that captured A's applied config
    const aBackup = backups.find(backup => JSON.parse(readFileSync(backup.path, 'utf8')).agents.sisyphus.model === 'a/model');
    assert.ok(aBackup, 'the A-state backup must be recoverable');
    const restored = await runCli(['restore', aBackup.id, '--json']);

    // Then: the active config returns to A's state
    assert.deepEqual(JSON.parse(restored.stdout), { ok: true, backupId: aBackup.id });
    assert.equal(restored.stderr, '');
    assert.equal(readConfig().agents.sisyphus.model, 'a/model');
  });

  // -----------------------------------------------------------------------
  // (c) existing save fails, --force succeeds, recoverable backup remains
  // -----------------------------------------------------------------------
  it('journey (c): existing save fails, --force succeeds, and the old bytes stay recoverable', async () => {
    // Given: a profile snapshotting the v1 config
    const v1 = fullValidConfig();
    v1.agents.oracle.model = 'v1/model';
    writeFileSync(configPath, JSON.stringify(v1, null, 2) + '\n');
    await runCli(['save', 'forced-journey']);

    // and a changed active config
    const v2 = fullValidConfig();
    v2.agents.oracle.model = 'v2/model';
    writeFileSync(configPath, JSON.stringify(v2, null, 2) + '\n');

    // When: saving over the existing profile without --force
    const rejected = await runCli(['save', 'forced-journey']);

    // Then: the collision is refused with the exists exit and no mutation
    assert.equal(rejected.exitCode, 4);
    assert.equal(rejected.stdout, '');
    assert.ok(rejected.stderr.includes('already exists'), rejected.stderr);
    assert.equal(JSON.parse(readFileSync(join(profilesDir, 'forced-journey.json'), 'utf8')).agents.oracle.model, 'v1/model');

    // When: forcing the save
    const forced = await runCli(['save', 'forced-journey', '--force', '--json']);

    // Then: the profile updates and the pre-force bytes are recoverable in a backup
    assert.equal(forced.exitCode, 0, forced.stderr);
    const response = JSON.parse(forced.stdout);
    assert.equal(response.ok, true);
    assert.ok(response.backupPath.includes('.profile-backup-forced-journey-'));
    assert.equal(JSON.parse(readFileSync(join(profilesDir, 'forced-journey.json'), 'utf8')).agents.oracle.model, 'v2/model');
    const backup = JSON.parse(readFileSync(response.backupPath, 'utf8'));
    assert.equal(backup.agents.oracle.model, 'v1/model');
  });

  // -----------------------------------------------------------------------
  // (d) injected mutation failure preserves recoverability
  // -----------------------------------------------------------------------
  it('journey (d): an injected replacement failure leaves a backup the user can restore', async () => {
    // Given: an active config with known bytes and a store whose replacement fails
    const storeDir = join(tmpDir, 'config store journey');
    mkdirSync(storeDir, { recursive: true });
    const journeyConfig = join(storeDir, 'oh-my-openagent.jsonc');
    const original = Buffer.from('{"current":true}\n');
    writeFileSync(journeyConfig, original);
    const failing = new ConfigStore({
      configPath: journeyConfig,
      replace: async () => { throw Object.assign(new Error('injected failure'), { code: 'EIO' }); },
    });

    // When: rendering a replacement fails after the pre-mutation backup
    await assert.rejects(failing.replaceRendered(async () => '{"next":true}\n'), { code: 'EIO' });

    // Then: active bytes survive and a backup holding the same bytes exists
    assert.deepEqual(readFileSync(journeyConfig), original, 'active bytes survive the injected failure');
    const [backup] = await failing.list();
    assert.deepEqual(readFileSync(backup.path), original, 'published backup holds the pre-mutation bytes');

    // When: the active config is later lost and the user recovers from the backup
    writeFileSync(journeyConfig, '{"broken":true}\n');
    const healthy = new ConfigStore({ configPath: journeyConfig });
    await healthy.restore(backup.id);

    // Then: restore recovers the pre-mutation bytes
    assert.deepEqual(readFileSync(journeyConfig), original, 'restore recovers the pre-mutation bytes');
  });

  // -----------------------------------------------------------------------
  // (e) concurrent switches serialize safely
  // -----------------------------------------------------------------------
  it('journey (e): concurrent switches serialize, keep distinct backups, and release the lock', async () => {
    // Given: two profiles with distinct models
    const first = fullValidConfig();
    first.agents.sisyphus.model = 'first/model';
    writeProfile('journey-first', first);
    const second = fullValidConfig();
    second.agents.sisyphus.model = 'second/model';
    writeProfile('journey-second', second);

    // When: both switches race through the CLI
    const results = await Promise.all([runCli(['switch', 'journey-first']), runCli(['switch', 'journey-second'])]);

    // Then: both serialize and succeed, each publishing a distinct backup
    for (const result of results) assert.equal(result.exitCode, 0, result.stderr);
    const backups = readdirSync(tmpDir).filter(name => name.startsWith(`${basename(configPath)}.backup-`));
    assert.equal(backups.length, 2);
    assert.equal(new Set(backups).size, 2);
    assert.equal(existsSync(join(tmpDir, '.omo-profile.lock')), false);
    const finalModel = readConfig().agents.sisyphus.model;
    assert.ok(['first/model', 'second/model'].includes(finalModel));
  });
});
