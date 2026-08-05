import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function run(command, args, options = {}) {
  try {
    return { exitCode: 0, stdout: execFileSync(command, args, { encoding: 'utf8', ...options }), stderr: '' };
  } catch (error) {
    return { exitCode: error.status ?? 1, stdout: error.stdout?.toString() ?? '', stderr: error.stderr?.toString() ?? '' };
  }
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
  run('pnpm', ['pack', '--pack-destination', packDir], { stdio: ['ignore', 'pipe', 'pipe'] });
  const tarballs = readdirSync(packDir).filter(entry => entry.endsWith('.tgz'));
  assert.equal(tarballs.length, 1, 'pack must produce one tarball');
  const tarball = join(packDir, tarballs[0]);

  const install = run('pnpm', ['add', '--prefix', prefix, '--ignore-scripts', tarball], { stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(install.exitCode, 0, `packed install failed:\n${install.stdout}\n${install.stderr}`);

  const binName = process.platform === 'win32' ? 'omo-profile.cmd' : 'omo-profile';
  const bin = join(prefix, 'node_modules', '.bin', binName);
  const env = { ...process.env, OMO_CONFIG_PATH: configPath, OMO_PROFILES_DIR: profilesDir };

  const help = run(bin, ['help'], { env });
  assert.equal(help.exitCode, 0, `installed help failed:\n${help.stderr}`);
  assert.match(help.stdout, /Usage:/, 'installed generated binary must print Usage:');

  const list = run(bin, ['list', '--json'], { env });
  assert.equal(list.exitCode, 0, `installed list failed:\n${list.stderr}`);
  assert.deepEqual(JSON.parse(list.stdout), { profiles: [{ id: 'packed', name: 'packed' }] });

  const invalid = run(bin, ['invalid-command'], { env });
  assert.notEqual(invalid.exitCode, 0, 'installed invalid command must fail');
  assert.match(invalid.stderr, /Unknown command/);

  console.log(`Installed generated binary: ${bin}`);
  console.log(`help: exit ${help.exitCode}\n${help.stdout.trim()}`);
  console.log(`list --json: exit ${list.exitCode}\n${list.stdout.trim()}`);
  console.log(`invalid command: exit ${invalid.exitCode}\n${invalid.stderr.trim()}`);
} finally {
  rmSync(root, { recursive: true, force: true });
  console.log(`Cleanup receipt: removed ${root}`);
}
