/**
 * Doctor runner: builds a shared diagnostic context once, then executes each
 * check against it in isolation.
 *
 * Every check is an async function of the form `(ctx) => Promise<CheckResult[]>`
 * and is fully unit-testable by constructing a minimal `ctx` directly (no
 * OpenCode install or real filesystem required). The runner never lets one
 * broken check abort the others — any thrown error becomes a `doctor.internal`
 * failure while the remaining checks still run.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';

import {
  CONFIG_FILENAMES,
  candidateConfigDirs,
  discoverConfig,
  ConfigNotFoundError,
} from '../config/discover-config.mjs';
import { ConfigDocument } from '../config/write-config.mjs';
import {
  profilesDir as defaultProfilesDir,
  listProfileFiles,
  idFromFilename,
  profilePath,
} from '../profile-io.mjs';
import {
  getAvailableModels as realGetAvailableModels,
  isOpencodeInstalled as realIsOpencodeInstalled,
  OpencodeNotFoundError,
} from '../opencode/models.mjs';

import { buildReport, FAIL, result } from './result.mjs';
import { checkConfigFound } from './checks/config-found.mjs';
import { checkConfigValid } from './checks/config-valid.mjs';
import { checkProfilesValid } from './checks/profiles-valid.mjs';
import { checkActiveProfile } from './checks/active-profile.mjs';
import { checkDuplicates } from './checks/duplicates.mjs';
import { checkModelsValid } from './checks/models-valid.mjs';
import { checkPermissions } from './checks/permissions.mjs';
import { checkBackups } from './checks/backups.mjs';
import { checkLockState } from './checks/lock-state.mjs';

const CHECKS = [
  checkConfigFound,
  checkConfigValid,
  checkProfilesValid,
  checkActiveProfile,
  checkDuplicates,
  checkModelsValid,
  checkPermissions,
  checkBackups,
  checkLockState,
];

function defaultIsProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code !== 'ESRCH'; }
}

/**
 * Every existing candidate config file across the auto-discovery search path.
 * @returns {string[]}
 */
export function listCandidates({ platform, env, home }) {
  const candidates = [];
  for (const dir of candidateConfigDirs({ platform, env, home })) {
    for (const name of CONFIG_FILENAMES) {
      const path = join(dir, name);
      if (existsSync(path)) candidates.push(path);
    }
  }
  return candidates;
}

/**
 * Load every saved profile, tolerating individual read/parse failures.
 * @param {string} dir
 * @returns {Promise<Array<{id:string, profile?:object, error?:Error}>>}
 */
async function loadProfiles(dir) {
  let files;
  try { files = listProfileFiles(dir); } catch { return []; }

  const entries = [];
  for (const file of files) {
    const id = idFromFilename(file);
    try {
      const profile = JSON.parse(await readFile(profilePath(dir, id), 'utf-8'));
      entries.push({ id, profile });
    } catch (error) {
      entries.push({ id, error });
    }
  }
  return entries;
}

/**
 * Build the shared diagnostic context. Everything a check needs is resolved
 * here exactly once; checks are pure consumers of `ctx`.
 *
 * @param {object} [options]
 * @param {boolean} [options.offline=false]
 * @param {string} [options.explicitConfig]
 * @param {string} [options.platform]
 * @param {object} [options.env]
 * @param {string} [options.home]
 * @param {string} [options.profilesDir]
 * @param {Function} [options.getAvailableModels]
 * @param {Function} [options.isOpencodeInstalled]
 * @param {Function} [options.now]
 * @param {number} [options.maxBackups=100]
 * @param {Function} [options.isProcessAlive]
 */
export async function buildContext(options = {}) {
  const {
    offline = false,
    explicitConfig,
    platform = process.platform,
    env = process.env,
    home = homedir(),
    profilesDir = defaultProfilesDir(),
    getAvailableModels = realGetAvailableModels,
    isOpencodeInstalled = realIsOpencodeInstalled,
    now = Date.now,
    maxBackups = 100,
    isProcessAlive = defaultIsProcessAlive,
  } = options;

  const ctx = { offline, platform, env, home, explicitConfig, profilesDir, now, maxBackups, isProcessAlive };

  ctx.candidates = listCandidates({ platform, env, home });

  try {
    ctx.discovery = discoverConfig({ explicitPath: explicitConfig, platform, env, home });
  } catch (error) {
    ctx.discoveryError = error instanceof ConfigNotFoundError ? error : error;
  }

  if (ctx.discovery) {
    ctx.configDir = dirname(ctx.discovery.path);
    ctx.configName = basename(ctx.discovery.path);
    try {
      const doc = await ConfigDocument.load(ctx.discovery.path);
      ctx.configValue = doc.value;
    } catch (error) {
      ctx.configError = error;
    }
  }

  ctx.profileEntries = await loadProfiles(ctx.profilesDir);

  if (!offline) {
    try {
      ctx.availableModels = await getAvailableModels();
      ctx.opencodeInstalled = true;
    } catch (error) {
      if (error instanceof OpencodeNotFoundError) ctx.opencodeInstalled = false;
      else {
        ctx.opencodeInstalled = true;
        ctx.availableModelsError = error;
      }
    }
  }

  return ctx;
}

/**
 * Run all doctor checks and build the report.
 * @param {object} [options] - Passed through to buildContext.
 * @returns {Promise<{healthy:boolean, summary:object, checks:object[]}>}
 */
export async function runDoctor(options = {}) {
  const ctx = await buildContext(options);
  const checks = [];

  for (const check of CHECKS) {
    try {
      const results = await check(ctx);
      checks.push(...(Array.isArray(results) ? results : [results]));
    } catch (error) {
      checks.push(result({
        id: 'doctor.internal',
        status: FAIL,
        section: 'Internal',
        message: `Internal doctor error: ${error.message}`,
        details: [error.stack ?? error.message],
      }));
    }
  }

  return buildReport(checks);
}
