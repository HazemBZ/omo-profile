import { open, link, lstat, readdir, readFile, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { ConfigParseError, parseConfigText } from './parse-config.mjs';
import { LifecycleError } from '../profile/lifecycle-errors.mjs';
import { createConfigTransaction } from '../io/exclusive-lock.mjs';

const MAX_PUBLISH_ATTEMPTS = 100;

export class MissingBackupError extends LifecycleError {
  constructor(id) {
    super(`Backup not found: ${id}`, 3);
    this.id = id;
  }
}

export class InvalidConfigError extends LifecycleError {
  constructor(path) {
    super(`Invalid configuration: ${path}`, 5);
    this.path = path;
  }
}

function backupPattern(configName) {
  return new RegExp(`^${escapeRegex(configName)}\\.backup-(\\d{13})-([A-Za-z0-9_-]+)$`);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function backupRecord(directory, configName, filename) {
  const match = backupPattern(configName).exec(filename);
  if (!match) return null;
  return {
    id: `${match[1]}-${match[2]}`,
    path: join(directory, filename),
  };
}

async function publishNoReplace(temporaryPath, targetPath) {
  await link(temporaryPath, targetPath);
  await unlink(temporaryPath);
}

async function replaceAtomically(temporaryPath, targetPath) {
  await rename(temporaryPath, targetPath);
}

export class ConfigStore {
  constructor({
    configPath,
    clock = Date.now,
    randomSuffix = () => randomBytes(9).toString('base64url'),
    publish = publishNoReplace,
    replace = replaceAtomically,
    beforeReplace = async () => {},
    transaction = createConfigTransaction(configPath),
  }) {
    this.configPath = configPath;
    this.directory = dirname(configPath);
    this.configName = basename(configPath);
    this.clock = clock;
    this.randomSuffix = randomSuffix;
    this.publish = publish;
    this.replace = replace;
    this.beforeReplace = beforeReplace;
    this.transaction = transaction;
  }

  async backup() {
    return this.transaction(async () => {
      await this.#assertActiveConfigRegular();
      const bytes = await readFile(this.configPath);
      this.#validate(bytes, this.configPath);
      return this.#publishBackup(bytes);
    });
  }

  /**
   * Render and publish a replacement while holding the config transaction.
   * The renderer owns ConfigDocument loading so JSONC formatting survives; this
   * store owns the backup and byte-level replacement.
   *
   * @param {() => Promise<string>} render
   * @returns {Promise<{ backup: { id: string, path: string } }>}
   */
  async replaceRendered(render) {
    return this.transaction(async () => {
      await this.#assertActiveConfigRegular();
      const nextBytes = await render();
      this.#validate(Buffer.from(nextBytes), this.configPath);
      const currentBytes = await readFile(this.configPath);
      this.#validate(currentBytes, this.configPath);
      const backup = await this.#publishBackup(currentBytes);
      await this.#assertActiveConfigRegular();
      await this.#replaceBytes(nextBytes);
      return { backup };
    });
  }

  async list() {
    return this.transaction(async () => {
      await this.#assertActiveConfigRegular();
      return this.#list();
    });
  }

  async #list() {
    let names;
    try {
      names = await readdir(this.directory);
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    return names
      .map(name => backupRecord(this.directory, this.configName, name))
      .filter(record => record !== null)
      .sort((left, right) => right.id.localeCompare(left.id));
  }

  async prune(keep) {
    if (!Number.isSafeInteger(keep) || keep < 0) {
      throw new RangeError('Backup retention must be a non-negative safe integer');
    }
    return this.transaction(async () => {
      await this.#assertActiveConfigRegular();
      const records = await this.#list();
      const removed = records.slice(keep);
      await Promise.all(removed.map(record => unlink(record.path)));
      return removed;
    });
  }

  async restore(id) {
    return this.transaction(async () => {
      await this.#assertActiveConfigRegular();
      const record = await this.#lookup(id);
      let backupBytes;
      try {
        backupBytes = await readFile(record.path);
      } catch (error) {
        if (error?.code === 'ENOENT') throw new MissingBackupError(id);
        throw error;
      }
      this.#validate(backupBytes, record.path);

      const currentBytes = await readFile(this.configPath);
      this.#validate(currentBytes, this.configPath);
      await this.#publishBackup(currentBytes);
      await this.#assertActiveConfigRegular();
      await this.#replaceBytes(backupBytes);
      return record;
    });
  }

  // Local locks serialize cooperating mutations; symlink refusal prevents an
  // accidental local config link from redirecting those mutations elsewhere.
  async #assertActiveConfigRegular() {
    const details = await lstat(this.configPath);
    if (!details.isFile() || details.isSymbolicLink()) throw new InvalidConfigError(this.configPath);
  }

  async #lookup(id) {
    if (!/^[0-9]{13}-[A-Za-z0-9_-]+$/.test(id)) throw new MissingBackupError(id);
    const record = backupRecord(this.directory, this.configName, `${this.configName}.backup-${id}`);
    if (!record) throw new MissingBackupError(id);
    try {
      await readFile(record.path);
    } catch (error) {
      if (error?.code === 'ENOENT') throw new MissingBackupError(id);
      throw error;
    }
    return record;
  }

  async #publishBackup(bytes) {
    for (let attempt = 0; attempt < MAX_PUBLISH_ATTEMPTS; attempt++) {
      const id = `${this.clock()}-${this.randomSuffix()}`;
      const targetPath = join(this.directory, `${this.configName}.backup-${id}`);
      const temporaryPath = join(this.directory, `.${this.configName}.backup-${id}.tmp`);
      try {
        await this.#writeFlushed(temporaryPath, bytes);
        await this.publish(temporaryPath, targetPath);
        return { id, path: targetPath };
      } catch (error) {
        await unlink(temporaryPath).catch(cleanupError => {
          if (cleanupError?.code !== 'ENOENT') throw cleanupError;
        });
        if (error?.code === 'EEXIST') continue;
        throw error;
      }
    }
    throw new Error('Unable to publish a unique backup after repeated collisions');
  }

  async #replaceBytes(bytes) {
    const temporaryPath = join(
      this.directory,
      `.${this.configName}.restore-${this.clock()}-${this.randomSuffix()}.tmp`,
    );
    try {
      await this.#writeFlushed(temporaryPath, bytes);
      await this.beforeReplace();
      await this.#assertActiveConfigRegular();
      await this.replace(temporaryPath, this.configPath);
    } catch (error) {
      await unlink(temporaryPath).catch(cleanupError => {
        if (cleanupError?.code !== 'ENOENT') throw cleanupError;
      });
      throw error;
    }
  }

  async #writeFlushed(path, bytes) {
    let handle;
    try {
      handle = await open(path, 'wx');
      await handle.writeFile(bytes);
      await handle.sync();
    } catch (error) {
      if (handle) {
        await handle.close();
        handle = undefined;
        await unlink(path);
      }
      throw error;
    } finally {
      if (handle) await handle.close();
    }
  }

  #validate(bytes, path) {
    try {
      parseConfigText(bytes.toString('utf8'), { path });
    } catch (error) {
      if (error instanceof ConfigParseError) throw new InvalidConfigError(path);
      throw error;
    }
  }
}
