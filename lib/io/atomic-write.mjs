import { open, rename as renameFile, unlink, lstat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

function temporaryPath(targetPath, randomSuffix) {
  return join(dirname(targetPath), `.${basename(targetPath)}.tmp.${randomSuffix()}`);
}

async function existingMode(targetPath) {
  try {
    return (await lstat(targetPath)).mode & 0o777;
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  let handle;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EPERM', 'EISDIR'].includes(error?.code)) throw error;
  } finally {
    await handle?.close();
  }
}

/**
 * Durably replace a file without exposing a partial target.
 *
 * The temporary file is exclusive and same-directory. Cleanup runs only before
 * rename, so a post-rename failure never risks deleting the published target.
 *
 * @param {string} targetPath
 * @param {string | Buffer} data
 * @param {{ randomSuffix?: () => string, write?: (handle: import('node:fs/promises').FileHandle, data: string | Buffer) => Promise<void>, rename?: (from: string, to: string) => Promise<void> }} [options]
 */
export async function atomicWrite(targetPath, data, {
  randomSuffix = () => randomBytes(12).toString('base64url'),
  write = (handle, bytes) => handle.writeFile(bytes),
  rename = renameFile,
} = {}) {
  const directory = dirname(targetPath);
  const temporary = temporaryPath(targetPath, randomSuffix);
  const mode = await existingMode(targetPath);
  let handle;
  let ownsTemporary = false;
  let published = false;
  try {
    handle = await open(temporary, 'wx', mode);
    ownsTemporary = true;
    await write(handle, data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, targetPath);
    published = true;
    await syncDirectory(directory);
  } finally {
    await handle?.close();
    if (ownsTemporary && !published) await unlink(temporary).catch(error => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
}
