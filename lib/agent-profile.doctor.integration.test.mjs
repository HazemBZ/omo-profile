import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = fileURLToPath(new URL('../agent-profile.mjs', import.meta.url));

const AGENTS = [
  'hephaestus', 'oracle', 'librarian', 'explore', 'multimodal-looker',
  'prometheus', 'metis', 'momus', 'atlas', 'sisyphus-junior', 'sisyphus',
];
const CATEGORIES = [
  'visual-engineering', 'ultrabrain', 'deep', 'artistry', 'quick',
  'unspecified-low', 'unspecified-high', 'writing',
];

function entry(model) {
  return { model, variant: 'default', fallback_models: [] };
}

function fullValidConfig() {
  const config = {
    $schema: 'https://example.com/schema.json',
    extraKey: 'should-survive',
    agents: {},
    categories: {},
  };
  for (const a of AGENTS) config.agents[a] = entry('opencode/deepseek-v4-flash-free');
  for (const c of CATEGORIES) config.categories[c] = entry('opencode/deepseek-v4-flash-free');
  return config;
}

let tmpDir;
let configPath;
let profilesDir;
let emptyBundleDir;

function runCli(args, env = {}) {
  return new Promise((resolve) => {
    execFile(
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

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'omo-profile-doctor-'));
  configPath = join(tmpDir, 'oh-my-openagent.json');
  profilesDir = join(tmpDir, 'profiles');
  mkdirSync(profilesDir);
  emptyBundleDir = join(tmpDir, 'empty-bundle');
  mkdirSync(emptyBundleDir);
  process.env.OMO_BUNDLED_PROFILES_DIR = emptyBundleDir;
  writeFileSync(configPath, JSON.stringify(fullValidConfig(), null, 2) + '\n');
});

afterEach(() => {
  delete process.env.OMO_BUNDLED_PROFILES_DIR;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('omo-profile doctor', () => {
  it('reports a healthy environment and exits 0', async () => {
    const { exitCode, stdout, stderr } = await runCli(['doctor', '--offline']);
    assert.equal(stderr, '');
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('OmO Profile Doctor'));
    assert.ok(stdout.includes('Healthy.'));
  });

  it('is read-only and never seeds profiles', async () => {
    await runCli(['doctor', '--offline']);
    assert.equal(readdirSync(profilesDir).length, 0);
    assert.equal(readdirSync(emptyBundleDir).length, 0);
  });

  it('emits machine-readable JSON with --json', async () => {
    const { exitCode, stdout } = await runCli(['doctor', '--json', '--offline']);
    assert.equal(exitCode, 0);
    const report = JSON.parse(stdout);
    assert.equal(typeof report.healthy, 'boolean');
    assert.equal(typeof report.summary, 'object');
    assert.ok(Array.isArray(report.checks));
    assert.ok(report.checks.some((c) => c.id === 'config.found'));
    assert.ok(report.checks.some((c) => c.id === 'models.availability'));
  });

  it('skips model checks with --offline', async () => {
    const { stdout } = await runCli(['doctor', '--offline']);
    assert.ok(stdout.includes('--offline'));
  });

  it('exits 1 when configuration is broken', async () => {
    writeFileSync(configPath, '{"agents": {"oracle": {"model": "x"');
    const { exitCode, stdout } = await runCli(['doctor', '--offline']);
    assert.equal(exitCode, 1);
    assert.ok(stdout.includes('failure'));
  });
});
