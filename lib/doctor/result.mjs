/**
 * Diagnostic result model shared by every doctor check and the renderer.
 *
 * A check emits one or more `CheckResult`s. Each result carries an
 * `id`, a `status` (pass|warn|fail|skip), a human `message`, an optional
 * `details` list, and a `section` used to group output. Any extra fields
 * (e.g. `path`, `model`) are preserved so the JSON consumer can act on
 * them programmatically.
 */

export const PASS = 'pass';
export const WARN = 'warn';
export const FAIL = 'fail';
export const SKIP = 'skip';

export const SEVERITIES = [PASS, WARN, FAIL, SKIP];

/**
 * @param {object} input
 * @param {string} input.id
 * @param {'pass'|'warn'|'fail'|'skip'} input.status
 * @param {string} input.message
 * @param {string} input.section
 * @param {string[]} [input.details]
 * @returns {object}
 */
export function result({ id, status, message, section, details = [], ...extras }) {
  const check = { id, status, message, section, ...extras };
  if (details.length > 0) check.details = details;
  return check;
}

/**
 * Count checks per severity.
 * @param {object[]} checks
 * @returns {{pass:number, warn:number, fail:number, skip:number}}
 */
export function summarize(checks) {
  const summary = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const check of checks) {
    if (Object.prototype.hasOwnProperty.call(summary, check.status)) {
      summary[check.status] += 1;
    }
  }
  return summary;
}

/**
 * Build the top-level report consumed by both the terminal renderer and
 * `--json` output.
 * @param {object[]} checks
 * @returns {{healthy: boolean, summary: object, checks: object[]}}
 */
export function buildReport(checks) {
  const summary = summarize(checks);
  return { healthy: summary.fail === 0, summary, checks };
}
