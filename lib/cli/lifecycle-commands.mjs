import { profilesDir, profilePath, readJson, bundledProfilesDir } from '../profile-io.mjs';
import { validateProfile, validateProfileId } from '../profile-validator.mjs';
import { ArgumentError, InvalidProfileError, MissingError } from '../profile/lifecycle-errors.mjs';
import { matchesProfile } from '../profile/compare.mjs';
import { diffProfiles } from '../profile/diff.mjs';
import { renderDryRun } from './render-diff.mjs';
import { configStore, findConfigPath, loadConfig, printSuccess, profileStore } from './runtime.mjs';

function requireProfileId(id) {
  if (!validateProfileId(id)) throw new ArgumentError('<id> must be a non-empty alphanumeric identifier (letters, digits, underscore, hyphen, dot).');
}
function profileFromConfig(id, config) { return { metadata: { name: id, created: new Date().toISOString() }, agents: config.agents || {}, categories: config.categories || {} }; }
function sections(profile) { return { agents: profile.agents ?? {}, categories: profile.categories ?? {} }; }
function switchDiff(id, config, profile) {
  const current = {};
  for (const section of ['agents', 'categories']) if (Object.hasOwn(config, section)) current[section] = config[section];
  const changes = diffProfiles(current, sections(profile));
  return { profile: id, changed: changes.length > 0, changes };
}
export async function cmdSave(id, force, showJson, explicitConfig) {
  requireProfileId(id); const backup = await profileStore().save(id, profileFromConfig(id, (await loadConfig(explicitConfig)).value), { force });
  printSuccess(showJson, { profileId: id, ...(backup ? { backupPath: backup } : {}) }, backup ? `Profile "${id}" saved; previous version backed up to ${backup}` : `Profile "${id}" saved`);
}
export async function cmdClone(source, destination, showJson) { await profileStore().clone(source, destination); printSuccess(showJson, { sourceId: source, profileId: destination }, `Profile "${source}" cloned to "${destination}"`); }
export async function cmdRename(source, destination, showJson) { await profileStore().rename(source, destination); printSuccess(showJson, { oldId: source, profileId: destination }, `Profile "${source}" renamed to "${destination}"`); }
async function confirmDelete(id) {
  if (!process.stdin.isTTY) throw new ArgumentError('delete requires --yes when standard input is not a TTY');
  process.stdout.write(`Delete profile "${id}"? [y/N] `);
  const answer = await new Promise(resolve => { process.stdin.once('data', data => resolve(data.toString().trim().toLowerCase())); process.stdin.once('end', () => resolve('')); process.stdin.resume(); });
  return answer === 'y' || answer === 'yes';
}
export async function cmdDelete(id, confirmed, showJson, explicitConfig) {
  requireProfileId(id); if (!confirmed && showJson) throw new ArgumentError('delete --json requires --yes'); if (!confirmed && !(await confirmDelete(id))) return;
  const store = profileStore(); const profile = await store.load(id); await store.delete(id); let matches = false;
  try {
    matches = matchesProfile((await loadConfig(explicitConfig)).value, profile);
  } catch (error) {
    // Best-effort active-config-match warning only: deletion has already
    // succeeded, so a missing (MissingError) or unreadable (InvalidProfileError)
    // config must not turn a completed delete into a failure. Only those two
    // config-load outcomes are suppressed; anything else still propagates.
    if (!(error instanceof MissingError || error instanceof InvalidProfileError)) throw error;
  }
  printSuccess(showJson, { profileId: id }, `Profile "${id}" deleted`);
  if (matches && !showJson) console.warn(`Warning: deleted profile "${id}" matched active configuration; active config was not changed.`);
}
export async function cmdBackups(showJson, explicitConfig) { const backups = await configStore(explicitConfig).list(); if (showJson) return printSuccess(true, { backups }); if (backups.length === 0) return console.log('No backups found.'); for (const backup of backups) console.log(backup.id); }
export async function cmdPruneBackups(keep, showJson, explicitConfig) { const removed = await configStore(explicitConfig).prune(keep); printSuccess(showJson, { removed: removed.map(backup => backup.id), keep }, `Pruned ${removed.length} backup(s); kept ${keep}`); }
export async function cmdRestore(id, showJson, explicitConfig) { const backup = await configStore(explicitConfig).restore(id); printSuccess(showJson, { backupId: backup.id }, `Backup "${backup.id}" restored`); }
export async function cmdSwitch(id, dryRun, showJson, explicitConfig) {
  requireProfileId(id); const path = profilePath(profilesDir(), id); let profile;
  try { profile = await profileStore().load(id); } catch (error) {
    if (dryRun && error instanceof MissingError) { try { profile = await readJson(profilePath(bundledProfilesDir(), id)); } catch { throw new MissingError(`Profile "${id}" not found at ${path}`); } }
    else if (error instanceof MissingError) throw new MissingError(`Profile "${id}" not found at ${path}`); else throw error;
  }
  const valid = validateProfile(profile); if (!valid.valid) throw new InvalidProfileError(`Profile "${id}" is invalid:\n${valid.errors.map(error => `  - ${error}`).join('\n')}`);
  if (dryRun) { const diff = switchDiff(id, (await loadConfig(explicitConfig)).value, profile); return printSuccess(showJson, { profileId: id, ...diff, dryRun: true }, renderDryRun(diff)); }
  const configPath = findConfigPath(explicitConfig); const { backup } = await configStore(explicitConfig).replaceRendered(async () => { const doc = await loadConfig(explicitConfig); doc.update(sections(profile)); return doc.render(); });
  if (showJson) return printSuccess(true, { profileId: id, backupId: backup.id, backupPath: backup.path, configPath });
  console.log(`Backup saved to ${backup.path}`); console.log(`Profile "${id}" applied to ${configPath}`); console.log(''); console.log('IMPORTANT: Restart opencode for changes to take effect.');
}
