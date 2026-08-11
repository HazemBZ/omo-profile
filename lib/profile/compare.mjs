import { isConfigObject, normalizeConfig } from './normalize.mjs';

function valuesEqual(left, right) {
  if (Object.is(left, right)) return true;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => valuesEqual(value, right[index]));
  }

  if (!isConfigObject(left) || !isConfigObject(right)) return false;

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every((key, index) => key === rightKeys[index] && valuesEqual(left[key], right[key]));
}

/**
 * Compare two configuration values after representation-only normalization.
 *
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
export function profilesEqual(left, right) {
  return valuesEqual(normalizeConfig(left), normalizeConfig(right));
}

/**
 * Check whether a config exactly matches all agent/category entries owned by a
 * sparse saved profile. Entries not declared by the profile are ignored.
 *
 * @param {unknown} current
 * @param {unknown} profile
 * @returns {boolean}
 */
export function matchesProfile(current, profile) {
  if (!isConfigObject(current) || !isConfigObject(profile)) return false;

  for (const section of ['agents', 'categories']) {
    const ownedEntries = profile[section];
    if (ownedEntries === undefined) continue;
    if (!isConfigObject(ownedEntries) || !isConfigObject(current[section])) return false;

    for (const [name, entry] of Object.entries(ownedEntries)) {
      if (!Object.hasOwn(current[section], name) || !profilesEqual(current[section][name], entry)) {
        return false;
      }
    }
  }

  return true;
}
