/**
 * Duplicate-profile detection diagnostics.
 *
 * Uses P2's canonical comparison (profilesEqual) to group saved profiles that
 * hold the same managed configuration. Duplicates are a warning, never a
 * failure — they are harmless but worth pointing at.
 */

import { profilesEqual } from '../../profile/compare.mjs';
import { PASS, WARN, result } from '../result.mjs';

/**
 * @param {object} ctx - Built doctor context (see run-doctor.mjs).
 * @returns {Promise<object[]>}
 */
export async function checkDuplicates(ctx) {
  const profiles = (ctx.profileEntries ?? []).filter(entry => entry.profile);

  const groups = [];
  const seen = new Set();
  for (let i = 0; i < profiles.length; i += 1) {
    if (seen.has(i)) continue;
    const group = [profiles[i].id];
    for (let j = i + 1; j < profiles.length; j += 1) {
      if (seen.has(j)) continue;
      if (profilesEqual(profiles[i].profile, profiles[j].profile)) {
        group.push(profiles[j].id);
        seen.add(j);
      }
    }
    seen.add(i);
    if (group.length > 1) groups.push(group);
  }

  if (groups.length === 0) {
    return [result({ id: 'duplicates', status: PASS, section: 'Profiles', message: 'No duplicate profiles' })];
  }

  return [result({
    id: 'duplicates',
    status: WARN,
    section: 'Profiles',
    message: 'Duplicate profiles detected',
    details: groups.map(ids => ids.join(', ')),
    groups,
  })];
}
