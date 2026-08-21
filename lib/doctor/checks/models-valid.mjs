/**
 * Model reference diagnostics.
 *
 * Collects every model referenced by the active configuration (via
 * collectModels), then compares them against what OpenCode reports as
 * available. Model availability is resolved once by run-doctor and passed in
 * as `ctx.availableModels`, so this check performs no child_process work and
 * is fully testable by injecting a fake model list.
 *
 * Wording follows spec §12: a model OpenCode does not report is described as
 * "not reported by OpenCode", never "invalid", because discovery can fail for
 * reasons unrelated to the model itself (provider/credentials/network).
 * Missing models are warnings, not failures.
 */

import { collectModels } from '../collect-models.mjs';
import { PASS, SKIP, WARN, result } from '../result.mjs';

/**
 * @param {object} ctx - Built doctor context (see run-doctor.mjs).
 * @returns {Promise<object[]>}
 */
export async function checkModelsValid(ctx) {
  if (!ctx.configValue) {
    return [result({ id: 'models.collected', status: SKIP, section: 'Models', message: 'Model reference collection skipped (no config)' })];
  }

  const collected = collectModels(ctx.configValue);
  const checks = [];

  checks.push(collected.length === 0
    ? result({ id: 'models.collected', status: PASS, section: 'Models', message: 'No model references' })
    : result({ id: 'models.collected', status: PASS, section: 'Models', message: `${collected.length} referenced model${collected.length === 1 ? '' : 's'}`, count: collected.length }));

  if (ctx.offline) {
    checks.push(result({ id: 'models.availability', status: SKIP, section: 'Models', message: 'Model availability checks skipped (--offline)' }));
    return checks;
  }

  if (ctx.opencodeInstalled === false) {
    checks.push(result({
      id: 'models.opencode',
      status: WARN,
      section: 'Models',
      message: '`opencode` executable not found',
      details: ['Model availability checks were skipped.', 'Profile configuration can still be validated.'],
    }));
    return checks;
  }

  if (ctx.availableModelsError) {
    checks.push(result({
      id: 'models.opencode',
      status: WARN,
      section: 'Models',
      message: 'Could not query OpenCode models',
      details: [ctx.availableModelsError.message],
    }));
    return checks;
  }

  if (collected.length === 0) {
    checks.push(result({ id: 'models.availability', status: SKIP, section: 'Models', message: 'No model references to check' }));
    return checks;
  }

  const available = new Set(ctx.availableModels ?? []);
  const missing = collected.filter(entry => !available.has(entry.model));

  if (missing.length === 0) {
    checks.push(result({ id: 'models.availability', status: PASS, section: 'Models', message: 'All referenced models reported by OpenCode' }));
    return checks;
  }

  for (const entry of missing) {
    checks.push(result({
      id: 'model.available',
      status: WARN,
      section: 'Models',
      message: `${entry.model} not reported by OpenCode`,
      details: ['referenced by:', ...entry.paths],
      model: entry.model,
      paths: entry.paths,
    }));
  }
  return checks;
}
