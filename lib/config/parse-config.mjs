/**
 * Parsing layer for the OmO configuration document.
 *
 * Wraps the JSONC engine's syntax errors into a user-facing message that
 * names the offending file and the exact line/column. Everything else about
 * the engine — comments, trailing commas, indentation detection — stays
 * below this layer.
 */

import { parseJsonc } from './jsonc.mjs';

/**
 * Thrown when the configuration text is not valid JSONC.
 *
 * Wraps the engine's JsoncSyntaxError into a message that names the file and
 * the exact position of the syntax problem.
 */
export class ConfigParseError extends Error {
  /**
   * @param {string} path — config file path to surface in the message
   * @param {number} line — 1-based line of the syntax error
   * @param {number} column — 1-based column of the syntax error
   * @param {string} message — underlying engine syntax message
   */
  constructor(path, line, column, message) {
    super(
      `Failed to parse OmO configuration:\n${path}\n\nLine ${line}, column ${column}:\n${message}`,
    );
    this.name = 'ConfigParseError';
    this.path = path;
    this.line = line;
    this.column = column;
  }
}

/**
 * True when `err` is the JSONC engine's syntax error.
 *
 * Matches by name and shape rather than by class identity so the engine is
 * free to keep the class private.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
function isJsoncSyntaxError(err) {
  return (
    err !== null &&
    typeof err === 'object' &&
    err.name === 'JsoncSyntaxError' &&
    typeof err.line === 'number' &&
    typeof err.column === 'number'
  );
}

/**
 * Parse configuration text into its semantic value.
 *
 * @param {string} text — raw file contents (BOM already stripped by caller)
 * @param {{ path?: string }} [options]
 * @returns {*} parsed value
 * @throws {ConfigParseError} when the text is not valid JSONC
 */
export function parseConfigText(text, { path = '<config>' } = {}) {
  try {
    return parseJsonc(text).value;
  } catch (err) {
    if (isJsoncSyntaxError(err)) {
      throw new ConfigParseError(path, err.line, err.column, err.message);
    }
    throw err;
  }
}