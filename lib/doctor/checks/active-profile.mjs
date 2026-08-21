/**
 * Active-profile detection diagnostics.
 *
 * Reuses P2's sparse match (matchesProfile) to report whether the current
 * configuration corresponds to exactly one saved profile, none, or several.
 */

import { matchesProfile } from '../../profile/compare.mjs';
import { PASS, SKIP, WARN, result } from '../result.mjs';

/**
 * @param {object} ctx - Built doctor context (see run-doctor.mjs).
 * @returns {Promise<object[]>}
 */
export async function checkActiveProfile(ctx) {
  if (!ctx.configValue) {
    return [result({ id: 'active-profile', status: SKIP, section: 'Profiles', message: 'Active profile check skipped (no config)' })];
  }

  const profiles = (ctx.profileEntries ?? []).filter(entry => entry.profile);
  if (profiles.length === 0) {
    return [result({ id: 'active-profile', status: SKIP, section: 'Profiles', message: 'Active profile check skipped (no profiles)' })];
  }

  const matches = profiles
    .filter(entry => matchesProfile(ctx.configValue, entry.profile))
    .map(entry => entry.id);

  if (matches.length === 1) {
    return [result({
      id: 'active-profile',
      status: PASS,
      section: 'Profiles',
      message: `Current configuration matches "${matches[0]}"`,
      profile: matches[0],
    })];
  }

  if (matches.length === 0) {
    return [result({
      id: 'active-profile',
      status: WARN,
      section: 'Profiles',
      message: 'Current configuration does not match any saved profile',
    })];
  }

  return [result({
    id: 'active-profile',
    status: WARN,
    section: 'Profiles',
    message: 'Current configuration matches multiple profiles',
    details: matches,
    profiles: matches,
  })];
}
