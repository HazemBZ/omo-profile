/**
 * CLI entry point for `omo-profile doctor`.
 *
 * Runs the read-only diagnostic suite and renders the result as human text or
 * JSON. Returns the report so the CLI can derive the exit code from it.
 */

import { runDoctor } from '../doctor/run-doctor.mjs';
import { renderReport } from '../doctor/render.mjs';

/**
 * @param {object} [options]
 * @param {boolean} [options.showJson=false]
 * @param {boolean} [options.offline=false]
 * @param {string} [options.explicitConfig]
 * @returns {Promise<{healthy:boolean, summary:object, checks:object[]}>}
 */
export async function cmdDoctor({ showJson = false, offline = false, explicitConfig } = {}) {
  const report = await runDoctor({ explicitConfig, offline });
  if (showJson) console.log(JSON.stringify(report, null, 2));
  else console.log(renderReport(report));
  return report;
}
