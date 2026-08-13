/**
 * Create a successful machine-readable lifecycle response.
 *
 * @param {object} resources
 * @returns {{ok: true} & object}
 */
export function jsonSuccess(resources) {
  return { ok: true, ...resources };
}
