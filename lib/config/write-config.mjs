/**
 * Write layer for the OmO configuration document.
 *
 * ConfigDocument is the only surface the CLI should touch: it loads a config
 * file, exposes its semantic value, supports surgical updates that preserve
 * comments and formatting, and saves atomically. Everything file-format
 * specific — where the file lives, JSON vs JSONC, comments, newline style,
 * atomic write — lives below this layer.
 */

import { readFile } from 'fs/promises';
import { atomicWrite } from '../io/atomic-write.mjs';
import { parseConfigText } from './parse-config.mjs';
import { discoverConfig } from './discover-config.mjs';
import {
  detectIndent,
  detectNewline,
  parseJsonc,
  replaceRootProperty,
  serializeValue,
} from './jsonc.mjs';

const BOM = '\uFEFF';

/**
 * Strip every trailing newline so exactly one can be re-appended.
 *
 * @param {string} text
 * @returns {string}
 */
function stripTrailingNewlines(text) {
  return text.replace(/(?:\r\n|\r|\n)+$/, '');
}

/**
 * Normalize every line ending to `newline`.
 *
 * The engine's serialized values use LF internally; this makes inserted
 * content match the file's own newline style without touching the bytes of
 * lines that already use it. Safe for valid JSONC: raw newlines cannot occur
 * inside strings or comments.
 *
 * @param {string} text
 * @param {'\n' | '\r\n'} newline
 * @returns {string}
 */
function normalizeNewlines(text, newline) {
  if (newline === '\n') return text.replace(/\r\n/g, '\n');
  return text.replace(/\r\n|\r|\n/g, '\r\n');
}

/**
 * In-memory handle on the OmO configuration file.
 *
 * Loads the file once, keeps the original bytes for surgical re-rendering,
 * and applies updates to the semantic value only. Nothing touches disk until
 * save() is called.
 */
export class ConfigDocument {
  /** @type {string} */
  #originalText;

  /**
   * Load a config file into a document.
   *
   * @param {string} path
   * @returns {Promise<ConfigDocument>}
   * @throws {ConfigParseError} when the file is not valid JSONC
   */
  static async load(path) {
    const raw = await readFile(path, 'utf8');
    const hasBom = raw.startsWith(BOM);
    const text = hasBom ? raw.slice(BOM.length) : raw;

    const doc = new ConfigDocument();
    doc.path = path;
    doc.value = parseConfigText(text, { path });
    doc.format = path.endsWith('.jsonc') ? 'jsonc' : 'json';
    doc.indent = detectIndent(text);
    doc.newline = detectNewline(text);
    doc.hasBom = hasBom;
    doc.#originalText = text;
    return doc;
  }

  /**
   * Replace the document's `agents` and `categories` top-level values
   * wholesale. Incoming values are deep-cloned so later caller mutation
   * cannot leak in. Every other top-level key is untouched. Does not write
   * to disk.
   *
   * @param {{ agents?: *, categories?: * }} [next]
   */
  update({ agents, categories } = {}) {
    if (agents !== undefined) this.value.agents = structuredClone(agents);
    if (categories !== undefined) this.value.categories = structuredClone(categories);
  }

  /**
   * Render the full new file content.
   *
   * Starts from the original text, replaces the `agents` and `categories`
   * root properties (inserting them if missing), matches the file's newline
   * style, re-applies the BOM, and ensures the file ends with exactly one
   * newline of the document's type.
   *
   * @returns {string}
   * @throws {Error} when the rendered output fails to re-parse as JSONC
   */
  render() {
    const indent = this.indent;
    let text = replaceRootProperty(
      this.#originalText,
      'agents',
      serializeValue(this.value.agents, indent),
      { indent },
    );
    text = replaceRootProperty(
      text,
      'categories',
      serializeValue(this.value.categories, indent),
      { indent },
    );
    text = normalizeNewlines(text, this.newline);
    if (this.hasBom) text = BOM + text;
    text = stripTrailingNewlines(text) + this.newline;

    try {
      parseJsonc(this.hasBom ? text.slice(BOM.length) : text);
    } catch {
      throw new Error('internal: rendered config failed to re-parse');
    }
    return text;
  }

  /**
   * Write the rendered content to disk atomically.
   *
   * @returns {Promise<string>} the path that was written
   */
  async save() {
    await atomicWrite(this.path, this.render());
    return this.path;
  }
}

/**
 * Locate the OmO configuration and load it into a document.
 *
 * @param {{ explicitPath?: string, platform?: string, env?: Record<string, string | undefined>, home?: string }} [options]
 * @returns {Promise<ConfigDocument>}
 * @throws {ConfigNotFoundError} when no configuration can be found
 */
export async function loadOmoConfig(options = {}) {
  const result = discoverConfig(options);
  return ConfigDocument.load(result.path);
}
