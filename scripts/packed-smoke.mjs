import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const BUNDLED_IDS = ['deepseek-v4-flash-free', 'gpt56-light', 'gpt56-mixed', 'gpt56-xlight'];

function run(command, args, options = {}) {
  try {
    return { exitCode: 0, stdout: execFileSync(command, args, { encoding: 'utf8', ...options }), stderr: '' };
  } catch (error) {
    return { exitCode: error.status ?? 1, stdout: error.stdout?.toString() ?? '', stderr: error.stderr?.toString() ?? '' };
  }
}

function runPnpm(args, options = {}) {
  const command = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'pnpm';
  const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm.cmd', ...args] : args;
  return run(command, commandArgs, options);
}

function runInstalledBinary(bin, args, options = {}) {
  if (process.platform !== 'win32') return run(bin, args, options);
  const commandString = `""${bin}" ${args.join(' ')}"`;
  return run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandString], {
    ...options,
    windowsVerbatimArguments: true,
  });
}

const root = mkdtempSync(join(tmpdir(), 'omo-profile-packed-'));
const packDir = join(root, 'pack output space');
const prefix = join(root, 'install prefix unicode-✓');
const configPath = join(root, 'config space', 'oh-my-openagent.json');
const profilesDir = join(root, 'profiles space', 'omo-profiles');
mkdirSync(packDir, { recursive: true });
mkdirSync(prefix, { recursive: true });
mkdirSync(profilesDir, { recursive: true });
mkdirSync(join(root, 'config space'), { recursive: true });
writeFileSync(configPath, '{}\n');
writeFileSync(join(profilesDir, 'packed.json'), JSON.stringify({ metadata: { name: 'packed' } }) + '\n');

try {
  const pack = runPnpm(['pack', '--pack-destination', packDir], { stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(pack.exitCode, 0, `pack failed:\n${pack.stdout}\n${pack.stderr}`);
  const tarballs = readdirSync(packDir).filter(entry => entry.endsWith('.tgz'));
  assert.equal(tarballs.length, 1, 'pack must produce one tarball');
  const tarball = join(packDir, tarballs[0]);

  const install = runPnpm(['add', '--prefix', prefix, '--ignore-scripts', tarball], { stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(install.exitCode, 0, `packed install failed:\n${install.stdout}\n${install.stderr}`);

  const binName = process.platform === 'win32' ? 'omo-profile.cmd' : 'omo-profile';
  const bin = join(prefix, 'node_modules', '.bin', binName);
  const env = { ...process.env, OMO_CONFIG_PATH: configPath, OMO_PROFILES_DIR: profilesDir };

  const help = runInstalledBinary(bin, ['help'], { env });
  assert.equal(help.exitCode, 0, `installed help failed:\n${help.stderr}`);
  assert.match(help.stdout, /Usage:/, 'installed generated binary must print Usage:');

  const list = runInstalledBinary(bin, ['list', '--json'], { env });
  assert.equal(list.exitCode, 0, `installed list failed:\n${list.stderr}`);
  const listed = JSON.parse(list.stdout).profiles;
  const listedIds = listed.map(p => p.id);
  assert.ok(listedIds.includes('packed'), `user profile "packed" must be listed, got: ${listedIds.join(', ')}`);
  for (const id of BUNDLED_IDS) {
    assert.ok(listedIds.includes(id), `bundled profile "${id}" must be listed, got: ${listedIds.join(', ')}`);
    assert.ok(existsSync(join(profilesDir, `${id}.json`)), `bundled profile "${id}" must be seeded to disk`);
  }

  const dryRun = runInstalledBinary(bin, ['switch', 'gpt56-mixed', '--dry-run'], { env });
  assert.equal(dryRun.exitCode, 0, `installed switch --dry-run failed:\n${dryRun.stderr}`);
  assert.match(dryRun.stdout, /\[dry-run\]/, 'dry-run marker in output');
  assert.match(dryRun.stdout, /Profile "gpt56-mixed": \d+ changes:/, 'canonical diff in dry-run output');
  assert.match(dryRun.stdout, /No files were modified\./, 'dry-run must not write files');

  const save = runInstalledBinary(bin, ['save', 'smoke-journey', '--json'], { env });
  assert.equal(save.exitCode, 0, `installed save failed:\n${save.stderr}`);
  assert.deepEqual(JSON.parse(save.stdout), { ok: true, profileId: 'smoke-journey' });

  const clone = runInstalledBinary(bin, ['clone', 'smoke-journey', 'smoke-copy', '--json'], { env });
  assert.equal(clone.exitCode, 0, `installed clone failed:\n${clone.stderr}`);
  assert.deepEqual(JSON.parse(clone.stdout), { ok: true, sourceId: 'smoke-journey', profileId: 'smoke-copy' });

  const rename = runInstalledBinary(bin, ['rename', 'smoke-copy', 'smoke-final', '--json'], { env });
  assert.equal(rename.exitCode, 0, `installed rename failed:\n${rename.stderr}`);
  assert.deepEqual(JSON.parse(rename.stdout), { ok: true, oldId: 'smoke-copy', profileId: 'smoke-final' });

  const remove = runInstalledBinary(bin, ['delete', 'smoke-final', '--yes', '--json'], { env });
  assert.equal(remove.exitCode, 0, `installed delete failed:\n${remove.stderr}`);
  assert.deepEqual(JSON.parse(remove.stdout), { ok: true, profileId: 'smoke-final' });
  assert.ok(existsSync(join(profilesDir, 'smoke-journey.json')), 'surviving profile must remain after delete');
  assert.equal(existsSync(join(profilesDir, 'smoke-final.json')), false, 'deleted profile must be gone');

  const invalid = runInstalledBinary(bin, ['invalid-command'], { env });
  assert.notEqual(invalid.exitCode, 0, 'installed invalid command must fail');
  assert.match(invalid.stderr, /Unknown command/);

  console.log(`Installed generated binary: ${bin}`);
  console.log(`help: exit ${help.exitCode}\n${help.stdout.trim()}`);
  console.log(`list --json: exit ${list.exitCode}\n${list.stdout.trim()}`);
  console.log(`switch --dry-run: exit ${dryRun.exitCode}\n${dryRun.stdout.trim()}`);
  console.log(`save → clone → rename → delete: ${[save, clone, rename, remove].map(r => r.exitCode).join(' → ')}`);
  console.log(`invalid command: exit ${invalid.exitCode}\n${invalid.stderr.trim()}`);
} finally {
  rmSync(root, { recursive: true, force: true });
  console.log(`Cleanup receipt: removed ${root}`);
}
