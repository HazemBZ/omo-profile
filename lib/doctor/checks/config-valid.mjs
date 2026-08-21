/**
 * Active configuration parsing + validation diagnostics.
 *
 * Reuses the exact P0 validator (validateProfile) that `save` and `switch`
 * rely on, so doctor and the mutating commands can never disagree about what
 * a valid configuration is.
 */

import { validateProfile } from '../../profile-validator.mjs';
import { FAIL, PASS, SKIP, result } from '../result.mjs';

/**
 * @param {object} ctx - Built doctor context (see run-doctor.mjs).
 * @returns {Promise<object[]>}
 */
export async function checkConfigValid(ctx) {
  if (!ctx.discovery) {
    return [
      result({ id: 'config.parse', status: SKIP, section: 'Configuration', message: 'Config parsing skipped (no config found)' }),
      result({ id: 'config.validate', status: SKIP, section: 'Configuration', message: 'Config validation skipped (no config found)' }),
    ];
  }

  if (ctx.configError) {
    const extras = {};
    if (ctx.configError.line != null) extras.line = ctx.configError.line;
    if (ctx.configError.column != null) extras.column = ctx.configError.column;
    return [
      result({
        id: 'config.parse',
        status: FAIL,
        section: 'Configuration',
        message: 'Configuration could not be parsed',
        details: [ctx.configError.message],
        ...extras,
      }),
      result({ id: 'config.validate', status: SKIP, section: 'Configuration', message: 'Config validation skipped (parse failed)' }),
    ];
  }

  const checks = [result({
    id: 'config.parse',
    status: PASS,
    section: 'Configuration',
    message: `Parsed successfully (${ctx.discovery.format.toUpperCase()})`,
  })];

  const validation = validateProfile(ctx.configValue);
  checks.push(validation.valid
    ? result({ id: 'config.validate', status: PASS, section: 'Configuration', message: 'Configuration valid' })
    : result({ id: 'config.validate', status: FAIL, section: 'Configuration', message: 'Invalid configuration', details: validation.errors }));

  return checks;
}
