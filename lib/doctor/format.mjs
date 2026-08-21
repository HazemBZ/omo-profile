/**
 * Small human-readable formatting helpers shared by doctor checks.
 */

/**
 * Format a millisecond age as a human-readable relative time.
 * @param {number} ms - Age in milliseconds (now - timestamp).
 * @returns {string}
 */
export function humanAge(ms) {
  const age = ms < 0 ? 0 : ms;
  if (age < 1000) return 'just now';
  const seconds = Math.floor(age / 1000);
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'} ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Format a byte count as a compact human-readable size.
 * @param {number} bytes
 * @returns {string}
 */
export function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
