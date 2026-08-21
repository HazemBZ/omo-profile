#!/usr/bin/env node

import { ensureBundledProfiles, profilesDir } from './lib/profile-io.mjs';
import { ArgumentError, exitCodeFor } from './lib/profile/lifecycle-errors.mjs';
import {
  cmdBackups, cmdClone, cmdDelete, cmdPruneBackups, cmdRename, cmdRestore,
  cmdSave, cmdSwitch,
} from './lib/cli/lifecycle-commands.mjs';
import { cmdCurrent, cmdDiff, cmdList } from './lib/cli/read-commands.mjs';
import { cmdDoctor } from './lib/cli/doctor-command.mjs';

function help() {
  console.log(`Usage: node agent-profile.mjs <command> [options]

Profile Manager for Oh My OpenAgent — save, list, identify, and switch
agent model profiles.

Global options:
  --config <path>           Use this config file instead of auto-discovery (JSON or JSONC)

Commands:
  list [--json]             List saved profiles
  current                   Show saved profile matches for active config
  diff <id> [--json]        Show changes a profile switch would make
  save <id> [--force] [--json]
                             Snapshot current config as profile <id>
  clone <source> <destination> [--json]
                             Copy a saved profile
  rename <old> <new> [--json]
                             Rename a saved profile
  delete <id> [--yes] [--json]
                             Delete a saved profile
  backups [--json]          List active-config backups
  backups prune --keep <positive integer> [--json]
                             Remove older active-config backups
  restore <backup-id> [--json]
                             Restore an active-config backup
  switch <id> [--dry-run] [--json]
                             Apply profile <id> to active config
  doctor [--json] [--offline]
                             Diagnose profile setup health (read-only)
  help                      Show this help message

Environment:
  OMO_CONFIG_PATH           Override path to oh-my-openagent.json
  OMO_CONFIG                Alias for --config
  OMO_PROFILES_DIR          Override profiles directory
  OMO_BUNDLED_PROFILES_DIR  Override bundled starter profiles directory

Notes:
  - Bundled starter profiles are seeded into the profiles directory on first
    use; existing profiles are never overwritten.
  - Switch backs up the active config before applying.
  - After a real (non-dry-run) switch, restart opencode for changes to take effect.`);
}

function extractConfigFlag(args) {
  const rest = [];
  let cliConfigPath;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--config') {
      const value = args[index + 1];
      if (value === undefined) throw new ArgumentError('--config requires a path');
      cliConfigPath = value;
      index += 1;
    } else if (arg.startsWith('--config=')) cliConfigPath = arg.slice('--config='.length);
    else rest.push(arg);
  }
  return { rest, cliConfigPath };
}

function assertExactArgs(args, positional, flags = []) {
  const values = args.slice(0, positional.length);
  const suppliedFlags = args.slice(positional.length);
  if (values.length !== positional.length || values.some(value => value.startsWith('--')) || suppliedFlags.some(flag => !flags.includes(flag)) || new Set(suppliedFlags).size !== suppliedFlags.length) {
    throw new ArgumentError(`Usage: ${positional.join(' ')}${flags.length > 0 ? ` [${flags.join('|')}]` : ''}`);
  }
}

async function seedBundledProfiles() {
  try { await ensureBundledProfiles(profilesDir()); }
  catch (error) { console.error(`Warning: could not seed bundled profiles: ${error.message}`); }
}

async function dispatch(rest, explicitConfig) {
  const command = rest[0];
  if (!command || ['help', '--help', '-h'].includes(command)) return help();
  if (['list', 'current', 'diff'].includes(command) || command === 'switch' && !rest.includes('--dry-run')) await seedBundledProfiles();
  switch (command) {
    case 'list': assertExactArgs(rest, ['list'], ['--json']); return cmdList(rest.includes('--json'));
    case 'current': assertExactArgs(rest, ['current']); return cmdCurrent(explicitConfig);
    case 'diff': assertExactArgs(rest, ['diff', '<id>'], ['--json']); return cmdDiff(rest[1], rest.includes('--json'), explicitConfig);
    case 'save': assertExactArgs(rest, ['save', '<id>'], ['--force', '--json']); return cmdSave(rest[1], rest.includes('--force'), rest.includes('--json'), explicitConfig);
    case 'clone': assertExactArgs(rest, ['clone', '<source>', '<destination>'], ['--json']); return cmdClone(rest[1], rest[2], rest.includes('--json'));
    case 'rename': assertExactArgs(rest, ['rename', '<old>', '<new>'], ['--json']); return cmdRename(rest[1], rest[2], rest.includes('--json'));
    case 'delete': assertExactArgs(rest, ['delete', '<id>'], ['--yes', '--json']); return cmdDelete(rest[1], rest.includes('--yes'), rest.includes('--json'), explicitConfig);
    case 'backups': return dispatchBackups(rest, explicitConfig);
    case 'restore': assertExactArgs(rest, ['restore', '<backup-id>'], ['--json']); return cmdRestore(rest[1], rest.includes('--json'), explicitConfig);
    case 'switch': assertExactArgs(rest, ['switch', '<id>'], ['--dry-run', '--json']); return cmdSwitch(rest[1], rest.includes('--dry-run'), rest.includes('--json'), explicitConfig);
    case 'doctor': {
      assertExactArgs(rest, ['doctor'], ['--json', '--offline']);
      const report = await cmdDoctor({ showJson: rest.includes('--json'), offline: rest.includes('--offline'), explicitConfig });
      if (!report.healthy) process.exitCode = 1;
      return;
    }
    default: throw new ArgumentError(`Unknown command: "${command}". Use "help" for usage.`);
  }
}

async function dispatchBackups(rest, explicitConfig) {
  if (rest[1] !== 'prune') { assertExactArgs(rest, ['backups'], ['--json']); return cmdBackups(rest.includes('--json'), explicitConfig); }
  const args = rest.slice(2); const showJson = args.at(-1) === '--json'; const core = showJson ? args.slice(0, -1) : args;
  if (core.length !== 2 || core[0] !== '--keep') throw new ArgumentError('Usage: backups prune --keep <positive integer> [--json]');
  const keep = Number(core[1]); if (!Number.isSafeInteger(keep) || keep <= 0) throw new ArgumentError('--keep must be a positive integer');
  return cmdPruneBackups(keep, showJson, explicitConfig);
}

async function main() {
  const { rest, cliConfigPath } = extractConfigFlag(process.argv.slice(2));
  return dispatch(rest, cliConfigPath || process.env.OMO_CONFIG || undefined);
}

main().catch(error => { console.error(`Error: ${error.message}`); process.exitCode = exitCodeFor(error); });
