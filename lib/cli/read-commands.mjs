import { join } from 'node:path';
import { profilesDir, readJson, listProfileFiles, idFromFilename, profilePath } from '../profile-io.mjs';
import { validateProfile, validateProfileId } from '../profile-validator.mjs';
import { ArgumentError, InvalidProfileError, MissingError } from '../profile/lifecycle-errors.mjs';
import { jsonSuccess } from '../profile/lifecycle-output.mjs';
import { matchesProfile } from '../profile/compare.mjs';
import { diffProfiles } from '../profile/diff.mjs';
import { renderDiff } from './render-diff.mjs';
import { loadConfig } from './runtime.mjs';

function requireProfileId(id) {
  if (!validateProfileId(id)) throw new ArgumentError('<id> must be a non-empty alphanumeric identifier (letters, digits, underscore, hyphen, dot).');
}

export async function cmdList(showJson) {
  const directory = profilesDir(); const files = listProfileFiles(directory);
  if (files.length === 0) {
    if (showJson) console.log(JSON.stringify(jsonSuccess({ profiles: [] })));
    else { console.log('No profiles found.'); console.log('Hint: run "omo-profile save <id>" to snapshot the active configuration as a profile.'); }
    return;
  }
  const profiles = [];
  for (const file of files) {
    const id = idFromFilename(file); let metadata = {};
    try { const profile = await readJson(join(directory, file)); if (profile.metadata && typeof profile.metadata === 'object') metadata = profile.metadata; }
    catch { metadata = { _corrupt: true }; }
    profiles.push({ id, ...metadata });
  }
  if (showJson) return console.log(JSON.stringify(jsonSuccess({ profiles }), null, 2));
  console.log('Saved profiles:');
  for (const profile of profiles) { if (profile._corrupt) console.log(`  ${profile.id} [corrupt]`); else console.log(`  ${profile.id}${profile.description ? ` — ${profile.description}` : ''}`); }
}

export async function cmdCurrent(explicitConfig) {
  const config = (await loadConfig(explicitConfig)).value; const directory = profilesDir(); const matches = [];
  for (const file of listProfileFiles(directory)) {
    try {
      const id = idFromFilename(file);
      if (matchesProfile(config, await readJson(join(directory, file)))) matches.push(id);
    } catch (error) {
      // A profile that vanished mid-scan (ENOENT) or holds malformed JSON
      // (SyntaxError from readJson) simply cannot be the current profile, so
      // it is skipped. Anything unexpected still reaches the CLI error boundary.
      if (error instanceof SyntaxError || error?.code === 'ENOENT') continue;
      throw error;
    }
  }
  if (matches.length === 1) return console.log(`Current profile: ${matches[0]}`);
  if (matches.length === 0) return console.log('Current configuration does not match a saved profile.');
  console.log(`Current configuration matches ${matches.length} profiles:`); for (const id of matches) console.log(`  ${id}`);
}

export async function cmdDiff(id, showJson, explicitConfig) {
  requireProfileId(id); const path = profilePath(profilesDir(), id); let profile;
  try { profile = await readJson(path); } catch { throw new MissingError(`Profile "${id}" not found at ${path}`); }
  const valid = validateProfile(profile); if (!valid.valid) throw new InvalidProfileError(`Profile "${id}" is invalid:\n${valid.errors.map(error => `  - ${error}`).join('\n')}`);
  const config = (await loadConfig(explicitConfig)).value; const current = {};
  for (const section of ['agents', 'categories']) if (Object.hasOwn(config, section)) current[section] = config[section];
  const diff = { profile: id, changed: false, changes: diffProfiles(current, { agents: profile.agents ?? {}, categories: profile.categories ?? {} }) }; diff.changed = diff.changes.length > 0;
  console.log(showJson ? JSON.stringify(jsonSuccess({ profileId: id, ...diff }), null, 2) : renderDiff(diff));
}
