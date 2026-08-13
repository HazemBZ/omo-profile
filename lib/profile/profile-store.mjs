import {
  lstat,
  link,
  mkdir,
  readFile,
  readdir,
  rename as renameFile,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { validateProfile, validateProfileId } from '../profile-validator.mjs';
import {
  ArgumentError,
  ExistsError,
  InvalidProfileError,
  MissingError,
} from './lifecycle-errors.mjs';

const DEFAULT_TRANSACTION = async action => action();
const DEFAULT_BEFORE_RENAME_PUBLISH = async () => {};
const BACKUP_PREFIX = '.profile-backup-';

/**
 * Safe filesystem lifecycle for saved profile data.
 * `transaction` accepts an async operation, allowing a later shared lock to
 * serialize store mutations without this module owning lock infrastructure.
 */
export class ProfileStore {
  #directory;
  #transaction;
  #beforeRenamePublish;

  constructor({ directory, transaction = DEFAULT_TRANSACTION, beforeRenamePublish = DEFAULT_BEFORE_RENAME_PUBLISH }) {
    this.#directory = directory;
    this.#transaction = transaction;
    this.#beforeRenamePublish = beforeRenamePublish;
  }

  async list() {
    await this.#ensureDirectory();
    await this.#assertNoBackupSymlinks();
    const entries = await readdir(this.#directory);
    const ids = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json') || entry.startsWith(BACKUP_PREFIX)) continue;
      if (!validateProfileId(entry.slice(0, -'.json'.length))) continue;
      await this.#assertRegularFile(join(this.#directory, entry), 'profile');
      ids.push(entry.slice(0, -'.json'.length));
    }
    return ids.sort();
  }

  async load(id) {
    const path = await this.#profilePath(id);
    const raw = await this.#readRegularFile(path, id);
    return this.#parseProfile(raw, id);
  }

  async save(id, profile, { force = false } = {}) {
    this.#assertId(id);
    this.#assertValidProfile(profile, id);
    return this.#transaction(async () => {
      await this.#ensureDirectory();
      await this.#assertNoBackupSymlinks();
      const path = this.#pathFor(id);
      const data = `${JSON.stringify(profile, null, 2)}\n`;
      const status = await this.#pathStatus(path, id);
      if (status === 'missing') {
        await this.#writeExclusive(path, data, id);
        return undefined;
      }
      if (!force) throw new ExistsError(`Profile "${id}" already exists`);
      const original = await this.#readRegularFile(path, id);
      const backup = await this.#writeBackup(id, original);
      await this.#replaceRegularFile(path, data, id);
      return backup;
    });
  }

  async clone(sourceId, destinationId) {
    this.#assertDistinctIds(sourceId, destinationId);
    return this.#transaction(async () => {
      await this.#ensureDirectory();
      await this.#assertNoBackupSymlinks();
      const source = await this.#readRegularFile(this.#pathFor(sourceId), sourceId);
      this.#parseProfile(source, sourceId);
      await this.#writeExclusive(this.#pathFor(destinationId), source, destinationId);
    });
  }

  async rename(sourceId, destinationId) {
    this.#assertDistinctIds(sourceId, destinationId);
    return this.#transaction(async () => {
      await this.#ensureDirectory();
      await this.#assertNoBackupSymlinks();
      const source = this.#pathFor(sourceId);
      const destination = this.#pathFor(destinationId);
      this.#parseProfile(await this.#readRegularFile(source, sourceId), sourceId);
      const destinationStatus = await this.#pathStatus(destination, destinationId);
      if (destinationStatus === 'present') {
        throw new ExistsError(`Profile "${destinationId}" already exists`);
      }
      await this.#beforeRenamePublish();
      await this.#publishRename(source, destination, destinationId);
    });
  }

  async delete(id) {
    this.#assertId(id);
    return this.#transaction(async () => {
      await this.#ensureDirectory();
      await this.#assertNoBackupSymlinks();
      const path = this.#pathFor(id);
      await this.#assertRegularFile(path, id);
      await unlink(path);
    });
  }

  #assertId(id) {
    if (!validateProfileId(id)) throw new ArgumentError(`Invalid profile ID: ${String(id)}`);
  }

  #assertDistinctIds(sourceId, destinationId) {
    this.#assertId(sourceId);
    this.#assertId(destinationId);
    if (sourceId === destinationId) {
      throw new ArgumentError('Source and destination profile IDs must differ');
    }
  }

  #assertValidProfile(profile, id) {
    const result = validateProfile(profile);
    if (!result.valid) {
      throw new InvalidProfileError(`Profile "${id}" is invalid: ${result.errors.join('; ')}`);
    }
  }

  #parseProfile(raw, id) {
    let profile;
    try {
      profile = JSON.parse(raw);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new InvalidProfileError(`Profile "${id}" contains invalid JSON`);
      }
      throw error;
    }
    this.#assertValidProfile(profile, id);
    return profile;
  }

  #pathFor(id) {
    return join(this.#directory, `${id}.json`);
  }

  async #profilePath(id) {
    this.#assertId(id);
    await this.#ensureDirectory();
    await this.#assertNoBackupSymlinks();
    return this.#pathFor(id);
  }

  async #ensureDirectory() {
    try {
      const details = await lstat(this.#directory);
      if (!details.isDirectory() || details.isSymbolicLink()) {
        throw new InvalidProfileError(`Profile directory is unsafe: ${this.#directory}`);
      }
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        await mkdir(this.#directory, { recursive: true });
        return;
      }
      throw error;
    }
  }

  async #pathStatus(path, id) {
    try {
      await this.#assertRegularFile(path, id);
      return 'present';
    } catch (error) {
      if (error && error.code === 'ENOENT') return 'missing';
      throw error;
    }
  }

  async #assertRegularFile(path, id) {
    const details = await lstat(path);
    if (!details.isFile() || details.isSymbolicLink()) {
      throw new InvalidProfileError(`Profile "${id}" path is unsafe`);
    }
  }

  async #readRegularFile(path, id) {
    try {
      await this.#assertRegularFile(path, id);
      return await readFile(path, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') throw new MissingError(`Profile "${id}" does not exist`);
      throw error;
    }
  }

  async #writeExclusive(path, data, id) {
    try {
      await writeFile(path, data, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        await this.#assertRegularFile(path, id);
        throw new ExistsError(`Profile "${id}" already exists`);
      }
      throw error;
    }
  }

  async #publishRename(source, destination, destinationId) {
    try {
      await link(source, destination);
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        await this.#assertRegularFile(destination, destinationId);
        throw new ExistsError(`Profile "${destinationId}" already exists`);
      }
      throw error;
    }
    await unlink(source);
  }

  async #writeBackup(id, data) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const backup = join(this.#directory, `${BACKUP_PREFIX}${id}-${Date.now()}-${attempt}.json`);
      try {
        await writeFile(backup, data, { encoding: 'utf8', flag: 'wx' });
        return backup;
      } catch (error) {
        if (error && error.code === 'EEXIST') continue;
        throw error;
      }
    }
    throw new ExistsError(`Could not create recoverable backup for profile "${id}"`);
  }

  async #replaceRegularFile(path, data, id) {
    const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
    try {
      await writeFile(temporary, data, { encoding: 'utf8', flag: 'wx' });
      await this.#assertRegularFile(path, id);
      await renameFile(temporary, path);
    } catch (error) {
      try {
        await unlink(temporary);
      } catch (cleanupError) {
        if (!cleanupError || cleanupError.code !== 'ENOENT') throw cleanupError;
      }
      throw error;
    }
  }

  async #assertNoBackupSymlinks() {
    const entries = await readdir(this.#directory);
    for (const entry of entries) {
      if (!entry.startsWith(BACKUP_PREFIX)) continue;
      const details = await lstat(join(this.#directory, entry));
      if (details.isSymbolicLink()) {
        throw new InvalidProfileError(`Profile backup path is unsafe: ${entry}`);
      }
    }
  }
}
