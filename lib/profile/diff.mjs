import { isConfigObject, normalizeConfig } from './normalize.mjs';
import { profilesEqual } from './compare.mjs';

const MISSING = Symbol('missing');

function joinPath(prefix, key) {
  const segment = /[.\[\]]/.test(key) ? `[${JSON.stringify(key)}]` : key;
  return prefix === '' ? segment : segment.startsWith('[') ? `${prefix}${segment}` : `${prefix}.${segment}`;
}

function addChange(changes, path, type, before, after) {
  if (type === 'added') {
    changes.push({ path, type, after });
    return;
  }
  if (type === 'removed') {
    changes.push({ path, type, before });
    return;
  }
  changes.push({ path, type, before, after });
}

function addLeaves(changes, path, value, type) {
  if (isConfigObject(value) && Object.keys(value).length > 0) {
    for (const key of Object.keys(value)) {
      addLeaves(changes, joinPath(path, key), value[key], type);
    }
    return;
  }
  addChange(
    changes,
    path,
    type,
    type === 'removed' ? value : undefined,
    type === 'added' ? value : undefined,
  );
}

function diffValues(changes, path, before, after) {
  if (before === MISSING) {
    addLeaves(changes, path, after, 'added');
    return;
  }
  if (after === MISSING) {
    addLeaves(changes, path, before, 'removed');
    return;
  }
  if (profilesEqual(before, after)) return;

  if (isConfigObject(before) && isConfigObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
      diffValues(
        changes,
        joinPath(path, key),
        Object.hasOwn(before, key) ? before[key] : MISSING,
        Object.hasOwn(after, key) ? after[key] : MISSING,
      );
    }
    return;
  }

  addChange(changes, path, 'changed', before, after);
}

/**
 * Return deterministic, leaf-level changes needed to transform before → after.
 * Objects are traversed by key; arrays remain atomic and order-sensitive.
 *
 * @param {unknown} before
 * @param {unknown} after
 * @returns {Array<{path: string, type: 'added'|'removed'|'changed', before?: unknown, after?: unknown}>}
 */
export function diffProfiles(before, after) {
  const changes = [];
  diffValues(changes, '', normalizeConfig(before), normalizeConfig(after));
  return changes;
}
