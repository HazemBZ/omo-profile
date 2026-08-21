/**
 * Terminal renderer for a doctor report.
 *
 * Groups checks by section (in a fixed order), renders each check as a
 * severity symbol plus message with indented details, then prints a summary
 * footer. Consumes the same structured report shape emitted by `--json`.
 */

const SYMBOLS = { pass: '✓', warn: '!', fail: '✗', skip: '-' };
const SECTION_ORDER = ['Configuration', 'Profiles', 'Models', 'Storage', 'Backups', 'Locks'];

/**
 * @param {{healthy:boolean, summary:object, checks:object[]}} report
 * @returns {string}
 */
export function renderReport(report) {
  const lines = ['OmO Profile Doctor', ''];

  const groups = new Map();
  for (const check of report.checks) {
    if (!groups.has(check.section)) groups.set(check.section, []);
    groups.get(check.section).push(check);
  }

  const sections = [
    ...SECTION_ORDER.filter(section => groups.has(section)),
    ...[...groups.keys()].filter(section => !SECTION_ORDER.includes(section)),
  ];

  for (const section of sections) {
    lines.push(section);
    for (const check of groups.get(section)) {
      lines.push(`  ${SYMBOLS[check.status] ?? '?'} ${check.message}`);
      for (const detail of check.details ?? []) lines.push(`    ${detail}`);
    }
    lines.push('');
  }

  const { summary } = report;
  if (summary.fail === 0 && summary.warn === 0) {
    lines.push('Healthy.');
  } else {
    const parts = [];
    if (summary.warn > 0) parts.push(`${summary.warn} warning${summary.warn === 1 ? '' : 's'}`);
    if (summary.fail > 0) parts.push(`${summary.fail} failure${summary.fail === 1 ? '' : 's'}`);
    lines.push(parts.join(', '));
  }

  return lines.join('\n');
}
