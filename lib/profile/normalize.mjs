/**
 * Canonical representation helpers for JSON-compatible configuration values.
 *
 * Normalization changes representation only: object keys are sorted
 * recursively, while arrays and primitive values retain their exact meaning.
 */

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Return a recursively canonical, non-mutating copy of a configuration value.
 *
 * @param {unknown} config
 * @returns {unknown}
 */
export function normalizeConfig(config) {
  if (Array.isArray(config)) {
    return config.map(normalizeConfig);
  }

  if (!isObject(config)) {
    return config;
  }

  return Object.fromEntries(
    Object.keys(config)
      .sort()
      .map(key => [key, normalizeConfig(config[key])]),
  );
}

/**
 * Whether a value is a JSON object rather than an array or null.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isConfigObject(value) {
  return isObject(value);
}
