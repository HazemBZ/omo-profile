/**
 * Configuration discovery diagnostics.
 *
 * Reports which config was found (and its format/source) or, when nothing
 * was found, the full list of paths that were tried. Also warns when the
 * auto-discovery scan turned up more than one candidate file, which is the
 * ambiguous setup introduced in P1.
 */

import { describeCheckedPaths } from '../../config/discover-config.mjs';
import { FAIL, PASS, WARN, result } from '../result.mjs';

/**
 * @param {object} ctx - Built doctor context (see run-doctor.mjs).
 * @returns {Promise<object[]>}
 */
export async function checkConfigFound(ctx) {
  const checks = [];

  if (ctx.discovery) {
    checks.push(result({
      id: 'config.found',
      status: PASS,
      section: 'Configuration',
      message: `Found config: ${ctx.discovery.path}`,
      path: ctx.discovery.path,
      format: ctx.discovery.format,
      source: ctx.discovery.source,
    }));
  } else {
    const checked = ctx.discoveryError?.checked ?? [];
    checks.push(result({
      id: 'config.found',
      status: FAIL,
      section: 'Configuration',
      message: 'No OmO config found',
      details: checked.length > 0
        ? describeCheckedPaths(checked).split('\n')
        : ['No Oh My OpenAgent configuration found.'],
    }));
  }

  // Ambiguity only matters for the auto-discovery scan. An explicit --config
  // or OMO_CONFIG_PATH is intentional, so don't nag about other candidates.
  if (ctx.discovery?.source === 'user' && ctx.candidates.length > 1) {
    const using = ctx.discovery.path;
    const others = ctx.candidates.filter(path => path !== using);
    checks.push(result({
      id: 'config.ambiguous',
      status: WARN,
      section: 'Configuration',
      message: 'Multiple OmO configs found',
      details: [`Using: ${using}`, 'Also found:', ...others],
      path: using,
      candidates: ctx.candidates,
    }));
  }

  return checks;
}
