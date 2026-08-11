/**
 * Pure validator for profile snapshots.
 *
 * A profile is a JSON file storing a snapshot of `agents` and
 * `categories` that can be applied to oh-my-openagent.json. Any subset
 * of the OmO configuration is allowed: agent/category names are
 * arbitrary, and only the structures omo-profile understands are
 * validated. Unknown fields are preserved untouched.
 */

import { matchesProfile, profilesEqual } from './profile/compare.mjs';

const MODEL_ID_RE = /^[a-zA-Z0-9][\w./-]{1,80}$/;

/**
 * Valid model entry shape.
 * @typedef {{model?: string, variant?: string, fallback_models?: Array<{model: string, variant?: string}>}} ModelEntry
 */

/**
 * Validate a full profile object.
 *
 * @param {unknown} obj - Parsed JSON value.
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateProfile(obj) {
  const errors = [];

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { valid: false, errors: ['Profile must be a non-null object'] };
  }

  // --- metadata (optional but encouraged) ---
  if (obj.metadata !== undefined) {
    if (typeof obj.metadata !== 'object' || Array.isArray(obj.metadata)) {
      errors.push('metadata must be an object if present');
    }
  }

  // --- agents (optional; any name allowed) ---
  if (obj.agents !== undefined) {
    if (typeof obj.agents !== 'object' || Array.isArray(obj.agents) || obj.agents === null) {
      errors.push('agents must be a non-null object');
    } else {
      for (const name of Object.keys(obj.agents)) {
        const m = validateModelEntry(obj.agents[name], `agents.${name}`);
        errors.push(...m);
      }
    }
  }

  // --- categories (optional; any name allowed) ---
  if (obj.categories !== undefined) {
    if (typeof obj.categories !== 'object' || Array.isArray(obj.categories) || obj.categories === null) {
      errors.push('categories must be a non-null object');
    } else {
      for (const name of Object.keys(obj.categories)) {
        const m = validateModelEntry(obj.categories[name], `categories.${name}`);
        errors.push(...m);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a single model entry.
 *
 * @param {unknown} entry
 * @param {string} path - Dot-path for error messages.
 * @returns {string[]}
 */
export function validateModelEntry(entry, path) {
  const errors = [];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    errors.push(`${path} must be a non-null object`);
    return errors;
  }

  // model (optional — partial overrides may omit it)
  if (entry.model !== undefined) {
    if (typeof entry.model !== 'string' || !entry.model) {
      errors.push(`${path}.model must be a non-empty string`);
    } else if (!MODEL_ID_RE.test(entry.model)) {
      errors.push(`${path}.model "${entry.model}" does not look like a valid model id`);
    }
  }

  // variant (optional, default "default")
  if (entry.variant !== undefined) {
    if (typeof entry.variant !== 'string' || !entry.variant) {
      errors.push(`${path}.variant must be a non-empty string if present`);
    }
  }

  // fallback_models (optional)
  if (entry.fallback_models !== undefined) {
    if (!Array.isArray(entry.fallback_models)) {
      errors.push(`${path}.fallback_models must be an array if present`);
    } else {
      for (let i = 0; i < entry.fallback_models.length; i++) {
        const fb = entry.fallback_models[i];
        const fbPath = `${path}.fallback_models[${i}]`;
        if (!fb || typeof fb !== 'object' || Array.isArray(fb)) {
          errors.push(`${fbPath} must be a non-null object`);
          continue;
        }
        if (typeof fb.model !== 'string' || !fb.model) {
          errors.push(`${fbPath}.model must be a non-empty string`);
        } else if (!MODEL_ID_RE.test(fb.model)) {
          errors.push(`${fbPath}.model "${fb.model}" does not look like a valid model id`);
        }
        if (fb.variant !== undefined && (typeof fb.variant !== 'string' || !fb.variant)) {
          errors.push(`${fbPath}.variant must be a non-empty string if present`);
        }
      }
    }
  }

  return errors;
}

/**
 * Deep-compare two model entries for equality.
 */
export function modelEntryEqual(a, b) {
  return profilesEqual(a, b);
}

/**
 * Check if a config matches a profile (i.e. all agent + category entries equal).
 * @param {{agents: object, categories: object}} config
 * @param {{agents: object, categories: object}} profile
 * @returns {boolean}
 */
export function configMatchesProfile(config, profile) {
  return matchesProfile(config, profile);
}
