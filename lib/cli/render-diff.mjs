function displayValue(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function renderChange(change) {
  if (change.type === 'added') return `  ${change.path}: added ${displayValue(change.after)}`;
  if (change.type === 'removed') return `  ${change.path}: removed ${displayValue(change.before)}`;
  return `  ${change.path}: ${displayValue(change.before)} → ${displayValue(change.after)}`;
}

/**
 * Render structured profile changes for terminal output.
 *
 * @param {{profile: string, changed: boolean, changes: Array<{path: string, type: string, before?: unknown, after?: unknown}>}} diff
 * @returns {string}
 */
export function renderDiff(diff) {
  if (!diff.changed) return `Profile "${diff.profile}": no changes.`;
  return [
    `Profile "${diff.profile}": ${diff.changes.length} changes:`,
    ...diff.changes.map(renderChange),
  ].join('\n');
}

/**
 * Render a non-mutating switch preview using the same structured diff.
 *
 * @param {{profile: string, changed: boolean, changes: Array<{path: string, type: string, before?: unknown, after?: unknown}>}} diff
 * @returns {string}
 */
export function renderDryRun(diff) {
  return [
    `[dry-run] Would switch to profile "${diff.profile}".`,
    renderDiff(diff),
    'No files were modified.',
  ].join('\n');
}
