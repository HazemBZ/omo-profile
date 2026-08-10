/**
 * Configuration file discovery for Oh My OpenAgent.
 *
 * Locates the real OpenCode configuration file across platforms using an
 * injectable { platform, env, home } context so tests never touch the real
 * machine. Supports explicit --config paths, the OMO_CONFIG_PATH env
 * override, and the OMO_CONFIG_DIR directory override.
 *
 * This module knows nothing about the OMO_CONFIG env var — that alias is
 * handled at the CLI layer.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Candidate configuration filenames in priority order.
 *
 * .jsonc wins over .json, and the modern "oh-my-openagent" basename wins
 * over the legacy "oh-my-opencode" basename.
 */
export const CONFIG_FILENAMES = Object.freeze([
  'oh-my-openagent.jsonc',
  'oh-my-openagent.json',
  'oh-my-opencode.jsonc',
  'oh-my-opencode.json',
]);

const CONFIG_NOT_FOUND_MESSAGE = 'No Oh My OpenAgent configuration found.';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the primary OpenCode configuration directory.
 *
 * Priority: OMO_CONFIG_DIR env override, then the platform default
 * (APPDATA/opencode on Windows when APPDATA is set, otherwise
 * home/.config/opencode).
 *
 * @param {{ platform?: string, env?: Record<string, string | undefined>, home?: string }} options
 * @returns {string}
 */
export function getOpenCodeConfigDir({
  platform = process.platform,
  env = process.env,
  home = homedir(),
} = {}) {
  if (env.OMO_CONFIG_DIR) return env.OMO_CONFIG_DIR;
  if (platform === 'win32' && env.APPDATA) return join(env.APPDATA, 'opencode');
  return join(home, '.config', 'opencode');
}

/**
 * Ordered directories to search for a configuration file.
 *
 * OMO_CONFIG_DIR narrows the search to a single directory. Windows with
 * APPDATA set searches APPDATA/opencode first, then home/.config/opencode.
 * Every other platform searches home/.config/opencode only.
 *
 * @param {{ platform?: string, env?: Record<string, string | undefined>, home?: string }} options
 * @returns {string[]}
 */
export function candidateConfigDirs({
  platform = process.platform,
  env = process.env,
  home = homedir(),
} = {}) {
  if (env.OMO_CONFIG_DIR) return [env.OMO_CONFIG_DIR];
  if (platform === 'win32' && env.APPDATA) {
    return [join(env.APPDATA, 'opencode'), join(home, '.config', 'opencode')];
  }
  return [join(home, '.config', 'opencode')];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when no configuration file can be found.
 *
 * `checked` lists every full path that was tried, in order.
 */
export class ConfigNotFoundError extends Error {
  /**
   * @param {string[]} checked — full paths tried, in order
   */
  constructor(checked) {
    super(CONFIG_NOT_FOUND_MESSAGE);
    this.name = 'ConfigNotFoundError';
    this.checked = checked;
  }
}

/**
 * Render the list of checked paths for user-facing error output.
 *
 * @param {string[]} checked
 * @returns {string}
 */
export function describeCheckedPaths(checked) {
  if (checked.length === 0) return 'Checked: (none)';
  return `Checked:\n${checked.map(path => `  ${path}`).join('\n')}`;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Map a config path to its format from the file extension.
 *
 * @param {string} path
 * @returns {'jsonc' | 'json'}
 */
function formatForPath(path) {
  return path.endsWith('.jsonc') ? 'jsonc' : 'json';
}

/**
 * Locate the active Oh My OpenAgent configuration file.
 *
 * Resolution priority:
 *   1. `explicitPath` (CLI --config) — must exist on disk.
 *   2. `env.OMO_CONFIG_PATH` — existing env override, must exist on disk.
 *   3. Scan `candidateConfigDirs` in order, checking `CONFIG_FILENAMES`
 *      within each directory; the first existing file wins.
 *
 * Throws ConfigNotFoundError (with `checked` paths) when nothing is found.
 *
 * @param {{ explicitPath?: string, platform?: string, env?: Record<string, string | undefined>, home?: string }} options
 * @returns {{ path: string, format: 'jsonc' | 'json', source: 'explicit' | 'env' | 'user' }}
 */
export function discoverConfig({
  explicitPath,
  platform = process.platform,
  env = process.env,
  home = homedir(),
} = {}) {
  if (explicitPath) {
    if (existsSync(explicitPath)) {
      return { path: explicitPath, format: formatForPath(explicitPath), source: 'explicit' };
    }
    throw new ConfigNotFoundError([explicitPath]);
  }

  if (env.OMO_CONFIG_PATH) {
    if (existsSync(env.OMO_CONFIG_PATH)) {
      return { path: env.OMO_CONFIG_PATH, format: formatForPath(env.OMO_CONFIG_PATH), source: 'env' };
    }
    throw new ConfigNotFoundError([env.OMO_CONFIG_PATH]);
  }

  const checked = [];
  for (const dir of candidateConfigDirs({ platform, env, home })) {
    for (const filename of CONFIG_FILENAMES) {
      const path = join(dir, filename);
      checked.push(path);
      if (existsSync(path)) {
        return { path, format: formatForPath(path), source: 'user' };
      }
    }
  }

  throw new ConfigNotFoundError(checked);
}