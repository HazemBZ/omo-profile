import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProfileStore } from './profile-store.mjs';
import {
  ArgumentError,
  ExistsError,
  InvalidProfileError,
  MissingError,
} from './lifecycle-errors.mjs';

const validProfile = (name = 'test') => ({ metadata: { name }, agents: {} });

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'omo-profile-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

describe('ProfileStore lifecycle', () => {
  it('lists sorted valid profile IDs and loads saved data', async (t) => {
    // Given: two saved profiles and a non-profile backup
    const directory = await temporaryDirectory(t);
    const store = new ProfileStore({ directory });
    await store.save('zeta', validProfile('zeta'));
    await store.save('alpha', validProfile('alpha'));
    await writeFile(join(directory, '.profile-backup-alpha-1.json'), 'old');

    // When: profiles are listed and loaded
    const ids = await store.list();
    const profile = await store.load('alpha');

    // Then: only profile data is exposed
    assert.deepEqual(ids, ['alpha', 'zeta']);
    assert.deepEqual(profile, validProfile('alpha'));
  });

  it('rejects invalid IDs and invalid profile data before mutation', async (t) => {
    // Given: an empty profile directory
    const directory = await temporaryDirectory(t);
    const store = new ProfileStore({ directory });

    // When: unsafe inputs cross store boundary
    const invalidId = store.save('../escape', validProfile());
    const invalidData = store.save('safe', { agents: [] });

    // Then: typed errors occur without files
    await assert.rejects(invalidId, ArgumentError);
    await assert.rejects(invalidData, InvalidProfileError);
    assert.deepEqual(await readdir(directory), []);
  });

  it('does not overwrite an existing profile unless force preserves it in a backup', async (t) => {
    // Given: existing profile bytes
    const directory = await temporaryDirectory(t);
    const store = new ProfileStore({ directory });
    const target = join(directory, 'daily.json');
    const original = '{"metadata":{"name":"original"}}\n';
    await writeFile(target, original);

    // When: normal save collides, then forced save replaces it
    await assert.rejects(store.save('daily', validProfile('replacement')), ExistsError);
    const backup = await store.save('daily', validProfile('replacement'), { force: true });

    // Then: collision preserves bytes and force makes recoverable backup
    assert.equal(await readFile(target, 'utf8'), '{\n  "metadata": {\n    "name": "replacement"\n  },\n  "agents": {}\n}\n');
    assert.match(backup, /\.profile-backup-daily-.*\.json$/);
    assert.equal(await readFile(backup, 'utf8'), original);
  });

  it('protects clone and rename destinations and rejects same IDs', async (t) => {
    // Given: source and existing destination profiles
    const directory = await temporaryDirectory(t);
    const store = new ProfileStore({ directory });
    await store.save('source', validProfile('source'));
    await store.save('destination', validProfile('destination'));

    // When: clone or rename would replace destination, or source equals destination
    // Then: no profile is replaced
    await assert.rejects(store.clone('source', 'destination'), ExistsError);
    await assert.rejects(store.rename('source', 'destination'), ExistsError);
    await assert.rejects(store.clone('source', 'source'), ArgumentError);
    await assert.rejects(store.rename('source', 'source'), ArgumentError);
    assert.deepEqual(await store.list(), ['destination', 'source']);
  });

  it('maps a missing rename source to MissingError without publishing destination', async (t) => {
    // Given: an empty profile directory
    const directory = await temporaryDirectory(t);
    const store = new ProfileStore({ directory });

    // When: rename receives a source that does not exist
    const rename = store.rename('missing', 'destination');

    // Then: callers receive typed missing error and no destination is created
    await assert.rejects(rename, MissingError);
    await assert.rejects(lstat(join(directory, 'destination.json')), { code: 'ENOENT' });
  });

  it('uses filesystem rename and deletes only profile data', async (t) => {
    // Given: a source profile and unrelated backup file
    const directory = await temporaryDirectory(t);
    const store = new ProfileStore({ directory });
    await store.save('source', validProfile('source'));
    const backup = join(directory, '.profile-backup-source-1.json');
    await writeFile(backup, 'recoverable');

    // When: profile is renamed then deleted
    await store.rename('source', 'renamed');
    await store.delete('renamed');

    // Then: profile moves and delete leaves backup untouched
    await assert.rejects(lstat(join(directory, 'source.json')), { code: 'ENOENT' });
    await assert.rejects(lstat(join(directory, 'renamed.json')), { code: 'ENOENT' });
    assert.equal(await readFile(backup, 'utf8'), 'recoverable');
  });

  it('preserves source and destination when destination appears before rename publication', async (t) => {
    // Given: destination is created after rename preflight and before publication
    const directory = await temporaryDirectory(t);
    const destination = join(directory, 'destination.json');
    const store = new ProfileStore({
      directory,
      beforeRenamePublish: async () => writeFile(destination, 'concurrent bytes\n'),
    });
    await store.save('source', validProfile('source'));

    // When: rename publishes into the concurrent destination
    await assert.rejects(store.rename('source', 'destination'), ExistsError);

    // Then: no-replace publication retains both files unchanged
    assert.deepEqual(await store.load('source'), validProfile('source'));
    assert.equal(await readFile(destination, 'utf8'), 'concurrent bytes\n');
  });

  it('rejects missing sources, symlinked directory or profile paths before mutation', async (t) => {
    // Given: regular external file and symlinked profile paths
    const root = await temporaryDirectory(t);
    const external = join(root, 'external.json');
    const directory = join(root, 'profiles');
    await writeFile(external, JSON.stringify(validProfile()));
    await symlink(external, directory);
    const symlinkedDirectoryStore = new ProfileStore({ directory });

    // When: store reaches unsafe directory
    await assert.rejects(symlinkedDirectoryStore.save('safe', validProfile()), InvalidProfileError);

    // Given: regular profile directory with source, destination, and backup symlinks
    await rm(directory);
    const store = new ProfileStore({ directory });
    await store.save('source', validProfile());
    await symlink(external, join(directory, 'linked-source.json'));
    await symlink(external, join(directory, 'linked-destination.json'));
    await symlink(external, join(directory, '.profile-backup-daily-1.json'));

    // Then: each unsafe path is rejected without changing regular source
    await assert.rejects(store.load('linked-source'), InvalidProfileError);
    await assert.rejects(store.clone('source', 'linked-destination'), InvalidProfileError);
    await assert.rejects(store.save('daily', validProfile(), { force: true }), InvalidProfileError);
    await rm(join(directory, '.profile-backup-daily-1.json'));
    await assert.rejects(store.load('missing'), MissingError);
    assert.deepEqual(await store.load('source'), validProfile());
  });

  it('leaves no temporary output and preserves source after failed clone publication', async (t) => {
    // Given: source exists and destination parent is replaced by a file after construction
    const directory = await temporaryDirectory(t);
    const store = new ProfileStore({ directory });
    await store.save('source', validProfile());
    await writeFile(join(directory, 'destination.json'), 'existing');

    // When: clone collides
    await assert.rejects(store.clone('source', 'destination'), ExistsError);

    // Then: source remains and no temporary store output exists
    assert.deepEqual(await store.load('source'), validProfile());
    assert.deepEqual((await readdir(directory)).filter(name => name.includes('.tmp.')), []);
  });

  it('rejects invalid stored sources without publishing clone or rename output', async (t) => {
    // Given: a malformed stored profile
    const directory = await temporaryDirectory(t);
    const store = new ProfileStore({ directory });
    await writeFile(join(directory, 'invalid.json'), '{"agents":[]}\n');

    // When: clone and rename read source data
    await assert.rejects(store.clone('invalid', 'clone'), InvalidProfileError);
    await assert.rejects(store.rename('invalid', 'renamed'), InvalidProfileError);

    // Then: neither operation publishes a destination or moves source
    assert.equal(await readFile(join(directory, 'invalid.json'), 'utf8'), '{"agents":[]}\n');
    await assert.rejects(lstat(join(directory, 'clone.json')), { code: 'ENOENT' });
    await assert.rejects(lstat(join(directory, 'renamed.json')), { code: 'ENOENT' });
  });
});
