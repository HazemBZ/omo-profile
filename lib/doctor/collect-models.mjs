/**
 * Collect every model reference in a configuration, retaining the paths
 * that reference each model so diagnostics can point at the exact spot.
 *
 * Handles the mixed fallback shapes a config may contain:
 *   - `model: "provider/a"`
 *   - `fallback_models: "provider/b"`                        (string)
 *   - `fallback_models: ["provider/b", "provider/c"]`        (array of strings)
 *   - `fallback_models: [{ model: "provider/b" }]`           (array of objects)
 *   - `fallback_models: ["provider/b", { model: "provider/c" }]` (mixed)
 *   - `fallback_models: { model: "provider/b" }`             (object)
 *
 * The collector is tolerant: it gathers whatever model strings it can
 * find and ignores shapes it does not understand. Validation strictness
 * is a separate concern owned by the P0 validator.
 */

/**
 * @param {unknown} config - Parsed configuration object.
 * @returns {Array<{model: string, paths: string[]}>} Deduplicated by
 *   model, sorted alphabetically, with every referencing path retained.
 */
export function collectModels(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return [];

  const byModel = new Map();

  const add = (model, path) => {
    if (typeof model !== 'string' || model.trim() === '') return;
    const key = model.trim();
    let entry = byModel.get(key);
    if (!entry) {
      entry = { model: key, paths: [] };
      byModel.set(key, entry);
    }
    if (!entry.paths.includes(path)) entry.paths.push(path);
  };

  for (const section of ['agents', 'categories']) {
    const entries = config[section];
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
    for (const [name, entry] of Object.entries(entries)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const base = `${section}.${name}`;
      add(entry.model, `${base}.model`);
      collectFallbacks(entry.fallback_models, `${base}.fallback_models`, add);
    }
  }

  return [...byModel.values()].sort((a, b) => a.model.localeCompare(b.model));
}

function collectFallbacks(fallbacks, basePath, add) {
  if (fallbacks === undefined || fallbacks === null) return;

  if (typeof fallbacks === 'string') {
    add(fallbacks, basePath);
    return;
  }

  if (Array.isArray(fallbacks)) {
    fallbacks.forEach((item, index) => {
      if (typeof item === 'string') add(item, `${basePath}[${index}]`);
      else if (item && typeof item === 'object') add(item.model, `${basePath}[${index}].model`);
    });
    return;
  }

  if (typeof fallbacks === 'object') {
    add(fallbacks.model, `${basePath}.model`);
  }
}
