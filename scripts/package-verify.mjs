import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const EXPECTED_MANIFEST = [
  'LICENSE',
  'README.md',
  'agent-profile.mjs',
  'lib/cli/lifecycle-commands.mjs',
  'lib/cli/read-commands.mjs',
  'lib/cli/render-diff.mjs',
  'lib/cli/runtime.mjs',
  'lib/config/config-store.mjs',
  'lib/config/discover-config.mjs',
  'lib/config/jsonc.mjs',
  'lib/config/parse-config.mjs',
  'lib/config/write-config.mjs',
  'lib/io/atomic-write.mjs',
  'lib/io/exclusive-lock.mjs',
  'lib/profile-io.mjs',
  'lib/profile-validator.mjs',
  'lib/profile/compare.mjs',
  'lib/profile/diff.mjs',
  'lib/profile/lifecycle-errors.mjs',
  'lib/profile/lifecycle-output.mjs',
  'lib/profile/normalize.mjs',
  'lib/profile/profile-store.mjs',
  'package.json',
  'profiles/deepseek-v4-flash-free.json',
  'profiles/gpt56-light.json',
  'profiles/gpt56-mixed.json',
  'profiles/gpt56-xlight.json',
];

const FORBIDDEN_PATH = /(^|\/)(\.omo|test|tests|fixture|fixtures|credentials?|local(?:-config)?|\.env)(\/|\.|$)/i;

export function validateManifest(manifest) {
  const actual = [...new Set(manifest)].sort();
  const expected = [...EXPECTED_MANIFEST].sort();
  assert.deepEqual(actual, expected, 'tarball manifest differs from exact runtime allowlist');
  for (const entry of actual) {
    assert.doesNotMatch(entry, FORBIDDEN_PATH, `forbidden package path: ${entry}`);
  }
  return actual;
}

function packManifest() {
  const pnpmArgs = ['pack', '--dry-run'];
  const command = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'pnpm';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm.cmd', ...pnpmArgs] : pnpmArgs;
  const output = execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const contents = output.split('\n');
  const start = contents.indexOf('Tarball Contents');
  const end = contents.indexOf('Tarball Details');
  assert.ok(start >= 0 && end > start, 'pnpm pack output missing manifest sections');
  return contents.slice(start + 1, end).map(line => line.trim()).filter(Boolean);
}

function verifySourceHelp() {
  const result = execFileSync(process.execPath, ['agent-profile.mjs', 'help'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.match(result, /Usage:/, 'baseline source CLI help must contain Usage:');
}

verifySourceHelp();
const manifest = validateManifest(packManifest());
for (const adversarial of ['.omo/session.json', 'tests/example.test.mjs', 'fixtures/config.json', 'credentials.json', 'local.config']) {
  assert.throws(() => validateManifest([...manifest, adversarial]), /manifest|forbidden/i);
}
console.log('Baseline source help: passed');
console.log('Exact tarball manifest:');
for (const entry of manifest) console.log(`  ${entry}`);
console.log('Adversarial manifest checks: passed');
