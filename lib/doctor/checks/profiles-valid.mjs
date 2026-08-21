/**
 * Saved-profile validation diagnostics.
 *
 * Validates every profile in the store individually. A broken profile never
 * aborts the scan — it is reported and the remaining profiles still get
 * checked.
 */

import { validateProfile } from '../../profile-validator.mjs';
import { FAIL, PASS, result } from '../result.mjs';

/**
 * @param {object} ctx - Built doctor context (see run-doctor.mjs).
 * @returns {Promise<object[]>}
 */
export async function checkProfilesValid(ctx) {
  const entries = ctx.profileEntries ?? [];

  if (entries.length === 0) {
    return [result({ id: 'profiles.count', status: PASS, section: 'Profiles', message: 'No saved profiles' })];
  }

  const checks = [result({
    id: 'profiles.count',
    status: PASS,
    section: 'Profiles',
    message: `${entries.length} profile${entries.length === 1 ? '' : 's'} found`,
    count: entries.length,
  })];

  const invalid = [];
  for (const entry of entries) {
    if (entry.error) {
      invalid.push({ id: entry.id, details: [`Could not read profile: ${entry.error.message}`] });
    } else {
      const validation = validateProfile(entry.profile);
      if (!validation.valid) invalid.push({ id: entry.id, details: validation.errors });
    }
  }

  if (invalid.length === 0) {
    checks.push(result({ id: 'profiles.valid', status: PASS, section: 'Profiles', message: 'All profiles valid' }));
    return checks;
  }

  for (const bad of invalid) {
    checks.push(result({
      id: 'profiles.invalid',
      status: FAIL,
      section: 'Profiles',
      message: `Profile "${bad.id}" is invalid`,
      details: bad.details,
      profile: bad.id,
    }));
  }
  return checks;
}
