/**
 * Adapter around the `opencode` executable for discovering available
 * models. Keeps all `child_process` usage here so doctor checks stay
 * clean and independently testable via dependency injection.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Raised when the `opencode` executable cannot be located on PATH. */
export class OpencodeNotFoundError extends Error {
  constructor(command = 'opencode') {
    super(`\`${command}\` executable not found`);
    this.name = 'OpencodeNotFoundError';
    this.command = command;
  }
}

/**
 * Parse the plain-text output of `opencode models` (one `provider/model`
 * per line) into a list of model ids.
 * @param {string} stdout
 * @returns {string[]}
 */
export function parseModelsOutput(stdout) {
  return String(stdout)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

/**
 * Query OpenCode for the models it reports as available.
 *
 * @param {object} [options]
 * @param {string} [options.command='opencode']
 * @param {Function} [options.exec] - Injectable exec for tests.
 * @param {number} [options.timeoutMs=20000]
 * @returns {Promise<string[]>}
 * @throws {OpencodeNotFoundError} when the executable is not on PATH.
 * @throws {Error} for any other failure (timeout, non-zero exit, provider issue).
 */
export async function getAvailableModels({
  command = 'opencode',
  exec = execFileAsync,
  timeoutMs = 20000,
} = {}) {
  let stdout;
  try {
    ({ stdout } = await exec(command, ['models'], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }));
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new OpencodeNotFoundError(command);
    throw error;
  }
  return parseModelsOutput(stdout);
}

/**
 * Check whether the `opencode` executable is present without querying models.
 * @param {object} [options]
 * @param {string} [options.command='opencode']
 * @param {Function} [options.exec] - Injectable exec for tests.
 * @param {number} [options.timeoutMs=10000]
 * @returns {Promise<boolean>}
 */
export async function isOpencodeInstalled({
  command = 'opencode',
  exec = execFileAsync,
  timeoutMs = 10000,
} = {}) {
  try {
    await exec(command, ['--version'], { timeout: timeoutMs });
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    // Any other failure means the binary exists but behaved unexpectedly.
    return true;
  }
}
