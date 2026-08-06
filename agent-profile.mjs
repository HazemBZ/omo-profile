#!/usr/bin/env node

/**
 * Agent Profile Manager for Oh My OpenAgent.
 *
 * Commands:
 *   list [--json]          List saved profiles
 *   current                Show which profile (or "custom") matches the active config
 *   save <id>              Snapshot active config as a named profile
 *   switch <id> [--dry-run] Apply a saved profile
 *   help                   Show this message
 *
 * Environment variables (for testing):
 *   OMO_CONFIG_PATH   Path to oh-my-openagent.json
 *   OMO_PROFILES_DIR  Directory of profile JSON files
 */

import { join } from 'path';
import {
  configPath, profilesDir, readJson, listProfileFiles,
  idFromFilename, filenameFromId, profilePath,
  ensureProfilesDir, ensureBundledProfiles, atomicWrite, backupFile,
} from './lib/profile-io.mjs';
import { validateProfile, configMatchesProfile } from './lib/profile-validator.mjs';

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdHelp() {
  console.log(`Usage: node agent-profile.mjs <command> [options]

Profile Manager for Oh My OpenAgent — save, list, identify, and switch
agent model profiles.

Commands:
  list [--json]             List saved profiles
  current                   Show active profile (name or "custom")
  save <id>                 Snapshot current config as profile <id>
  switch <id> [--dry-run]   Apply profile <id> to active config
  help                      Show this help message

Environment:
  OMO_CONFIG_PATH           Override path to oh-my-openagent.json
  OMO_PROFILES_DIR          Override profiles directory
  OMO_BUNDLED_PROFILES_DIR  Override bundled starter profiles directory

Notes:
  - Bundled starter profiles are seeded into the profiles directory on first
    use; existing profiles are never overwritten.
  - Switch backs up the active config before applying.
  - After a real (non-dry-run) switch, restart opencode for changes to take effect.`);
}

async function cmdList(showJson) {
  const dir = profilesDir();
  const files = listProfileFiles(dir);

  if (files.length === 0) {
    if (showJson) {
      console.log(JSON.stringify({ profiles: [] }));
    } else {
      console.log('No profiles found.');
      console.log('Hint: run "omo-profile save <id>" to snapshot the active configuration as a profile.');
    }
    return;
  }

  const profiles = [];
  for (const f of files) {
    const id = idFromFilename(f);
    let meta = {};
    try {
      const data = await readJson(join(dir, f));
      if (data.metadata && typeof data.metadata === 'object') {
        meta = data.metadata;
      }
    } catch (_readErr) {
      meta = { _corrupt: true };
    }
    profiles.push({ id, ...meta });
  }

  if (showJson) {
    console.log(JSON.stringify({ profiles }, null, 2));
    return;
  }

  console.log('Saved profiles:');
  for (const p of profiles) {
    if (p._corrupt) {
      console.log(`  ${p.id} [corrupt]`);
      continue;
    }
    const desc = p.description ? ` — ${p.description}` : '';
    console.log(`  ${p.id}${desc}`);
  }
}

async function cmdCurrent() {
  let config;
  try {
    config = await readJson(configPath());
  } catch (err) {
    console.error(`Error: Cannot read config at ${configPath()}: ${err.message}`);
    process.exit(1);
  }

  const dir = profilesDir();
  const files = listProfileFiles(dir);

  if (files.length === 0) {
    console.log('custom');
    return;
  }

  for (const f of files) {
    const id = idFromFilename(f);
    try {
      const profile = await readJson(join(dir, f));
      if (configMatchesProfile(config, profile)) {
        console.log(id);
        return;
      }
    } catch (_skip) {
      /* unparseable profile — skip */
    }
  }

  console.log('custom');
}

async function cmdSave(id) {
  if (!id || typeof id !== 'string' || !/^[\w.-]+$/.test(id)) {
    console.error('Error: <id> must be a non-empty alphanumeric identifier (letters, digits, underscore, hyphen, dot).');
    process.exit(1);
  }

  let config;
  try {
    config = await readJson(configPath());
  } catch (err) {
    console.error(`Error: Cannot read config at ${configPath()}: ${err.message}`);
    process.exit(1);
  }

  const profile = {
    metadata: {
      name: id,
      created: new Date().toISOString(),
    },
    agents: config.agents || {},
    categories: config.categories || {},
  };

  const valid = validateProfile(profile);
  if (!valid.valid) {
    console.error('Error: Current config does not form a valid profile:');
    for (const e of valid.errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const dir = profilesDir();
  await ensureProfilesDir(dir);

  const outPath = join(dir, filenameFromId(id));
  await atomicWrite(outPath, JSON.stringify(profile, null, 2) + '\n');
  console.log(`Profile "${id}" saved to ${outPath}`);
}

async function cmdSwitch(id, isDryRun) {
  if (!id || typeof id !== 'string' || !/^[\w.-]+$/.test(id)) {
    console.error('Error: <id> must be a non-empty alphanumeric identifier (letters, digits, underscore, hyphen, dot).');
    process.exit(1);
  }

  // Read profile
  const dir = profilesDir();
  const pPath = profilePath(dir, id);
  let profile;
  try {
    profile = await readJson(pPath);
  } catch (_readErr) {
    console.error(`Error: Profile "${id}" not found at ${pPath}`);
    process.exit(1);
  }

  // Validate profile
  const valid = validateProfile(profile);
  if (!valid.valid) {
    console.error(`Error: Profile "${id}" is invalid:`);
    for (const e of valid.errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  if (isDryRun) {
    /* eslint-disable-next-line no-console */
    console.log(`[dry-run] Would apply profile "${id}":`);
    console.log(`  Config:   ${configPath()}`);
    console.log(`  Backup:   ${configPath()}.bak-<timestamp>`);
    console.log('  Changes:  agents + categories (all other keys preserved)');
    console.log('');
    console.log('  Agent assignments:');
    for (const [name, entry] of Object.entries(profile.agents).sort()) {
      console.log(`    ${name.padEnd(20)} ${entry.model}${entry.variant && entry.variant !== 'default' ? ` (${entry.variant})` : ''}`);
    }
    console.log('');
    console.log('  Category assignments:');
    for (const [name, entry] of Object.entries(profile.categories).sort()) {
      console.log(`    ${name.padEnd(20)} ${entry.model}${entry.variant && entry.variant !== 'default' ? ` (${entry.variant})` : ''}`);
    }
    return;
  }

  // Read active config
  let activeConfig;
  try {
    activeConfig = await readJson(configPath());
  } catch (err) {
    console.error(`Error: Cannot read config at ${configPath()}: ${err.message}`);
    process.exit(1);
  }

  // Backup
  try {
    const backupPath = await backupFile(configPath());
    console.log(`Backup saved to ${backupPath}`);
  } catch (err) {
    console.error(`Error: Could not create backup: ${err.message}`);
    process.exit(1);
  }

  // Atomic update: replace only agents + categories, keep everything else
  activeConfig.agents = JSON.parse(JSON.stringify(profile.agents));
  activeConfig.categories = JSON.parse(JSON.stringify(profile.categories));

  await atomicWrite(configPath(), JSON.stringify(activeConfig, null, 2) + '\n');
  console.log(`Profile "${id}" applied to ${configPath()}`);
  console.log('');
  console.log('IMPORTANT: Restart opencode for changes to take effect.');
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

/**
 * Seed bundled starter profiles into the profiles directory (best-effort).
 * A failure to seed is never fatal: commands still operate on whatever
 * profiles are already present.
 */
async function seedBundledProfiles() {
  try {
    await ensureBundledProfiles(profilesDir());
  } catch (err) {
    console.error(`Warning: could not seed bundled profiles: ${err.message}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    await cmdHelp();
    return;
  }

  // Profile-reading commands see bundled starter profiles once seeded.
  if (cmd === 'list' || cmd === 'current' || cmd === 'switch') {
    await seedBundledProfiles();
  }

  switch (cmd) {
    case 'list': {
      await cmdList(args.includes('--json'));
      break;
    }
    case 'current': {
      await cmdCurrent();
      break;
    }
    case 'save': {
      await cmdSave(args[1]);
      break;
    }
    case 'switch': {
      await cmdSwitch(args[1], args.includes('--dry-run'));
      break;
    }
    default: {
      console.error(`Unknown command: "${cmd}". Use "help" for usage.`);
      process.exit(1);
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
