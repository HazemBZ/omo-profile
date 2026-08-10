/**
 * Contracts for the config document layer (parse-config.mjs + write-config.mjs).
 *
 * Every filesystem test uses an isolated temporary directory cleaned up via
 * t.after. The JSONC engine (jsonc.mjs) and config discovery
 * (discover-config.mjs) are imported as dependencies, not re-implemented.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigDocument, loadOmoConfig } from './write-config.mjs';
import { ConfigParseError, parseConfigText } from './parse-config.mjs';
import { detectNewline, parseJsonc } from './jsonc.mjs';

async function temporaryDirectory(t, prefix = 'omo-config-') {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

describe('parseConfigText', () => {
  it('returns the semantic value for valid JSONC', () => {
    assert.deepEqual(parseConfigText('{\n  // comment\n  "a": 1,\n}'), { a: 1 });
  });

  it('wraps engine syntax errors into a ConfigParseError', () => {
    assert.throws(() => parseConfigText('{'), (err) => {
      assert.ok(err instanceof ConfigParseError);
      assert.equal(err.path, '<config>');
      assert.equal(typeof err.line, 'number');
      assert.equal(typeof err.column, 'number');
      assert.ok(err.message.includes('Failed to parse OmO configuration:'));
      assert.ok(err.message.includes('<config>'));
      assert.ok(err.message.includes('Line '));
      assert.ok(err.message.includes('column'));
      return true;
    });
  });

  it('uses the provided path in the error message', () => {
    assert.throws(() => parseConfigText('{', { path: '/tmp/x.jsonc' }), (err) => {
      assert.ok(err instanceof ConfigParseError);
      assert.equal(err.path, '/tmp/x.jsonc');
      assert.ok(err.message.includes('/tmp/x.jsonc'));
      return true;
    });
  });
});

describe('ConfigDocument.load', () => {
  it('loads a JSONC config with comments and trailing commas', async (t) => {
    const dir = await temporaryDirectory(t);
    const file = join(dir, 'config.jsonc');
    await writeFile(file, `{
  // Keep this comment
  "agents": {
    "oracle": {
      "model": "old/model",
    },
  },
  "categories": {},
}
`);
    const doc = await ConfigDocument.load(file);
    assert.deepEqual(doc.value, {
      agents: { oracle: { model: 'old/model' } },
      categories: {},
    });
    assert.equal(doc.format, 'jsonc');
    assert.equal(doc.indent, '  ');
    assert.equal(doc.newline, '\n');
    assert.equal(doc.hasBom, false);
  });

  it('round-trips a JSONC config preserving comments and formatting', async (t) => {
    const dir = await temporaryDirectory(t);
    const file = join(dir, 'config.jsonc');
    const text = `{
  // Keep this comment
  "agents": {
    "oracle": {
      "model": "old/model",
    },
  },
}`;
    await writeFile(file, text);
    const doc = await ConfigDocument.load(file);
    doc.update({ agents: { oracle: { model: 'new/model' } }, categories: {} });
    const after = doc.render();
    assert.ok(after.includes('// Keep this comment'), 'comment preserved');
    assert.ok(after.includes('"model": "new/model"'), 'new model present');
    assert.ok(!after.includes('old/model'), 'old model gone');
    assert.doesNotThrow(() => parseJsonc(after), 'rendered output is still valid JSONC');
  });

  it('preserves untouched top-level lines byte-for-byte', async (t) => {
    const dir = await temporaryDirectory(t);
    const file = join(dir, 'config.jsonc');
    const text = `{
  // Top comment
  "$schema": "https://example.com/schema.json",
  "extraKey": "keep-me",
  "agents": {
    "oracle": {
      "model": "old"
    }
  },
  "categories": {}
}`;
    await writeFile(file, text);
    const doc = await ConfigDocument.load(file);
    doc.update({ agents: { oracle: { model: 'new' } } });
    const after = doc.render();
    assert.ok(
      after.includes('  "$schema": "https://example.com/schema.json",'),
      '$schema line byte-identical',
    );
    assert.ok(after.includes('  "extraKey": "keep-me",'), 'extraKey line byte-identical');
    assert.ok(after.includes('// Top comment'), 'top comment preserved');
  });

  it('keeps CRLF line endings after an update', async (t) => {
    const dir = await temporaryDirectory(t);
    const file = join(dir, 'config.jsonc');
    const text =
      '{\r\n' +
      '  "agents": {\r\n' +
      '    "oracle": {\r\n' +
      '      "model": "old"\r\n' +
      '    }\r\n' +
      '  },\r\n' +
      '  "categories": {}\r\n' +
      '}\r\n';
    await writeFile(file, text);
    const doc = await ConfigDocument.load(file);
    assert.equal(doc.newline, '\r\n');
    doc.update({ agents: { oracle: { model: 'new' } }, categories: {} });
    const after = doc.render();
    assert.equal(detectNewline(after), '\r\n');
    for (const line of after.split('\r\n')) {
      assert.ok(!line.includes('\n'), `bare \\n found in line: ${JSON.stringify(line)}`);
    }
  });

  it('keeps tab indentation and indents inserted content with tabs', async (t) => {
    const dir = await temporaryDirectory(t);
    const file = join(dir, 'config.jsonc');
    const text =
      '{\n' +
      '\t// comment\n' +
      '\t"extraKey": 1,\n' +
      '\t"agents": {\n' +
      '\t\t"oracle": {\n' +
      '\t\t\t"model": "old"\n' +
      '\t\t}\n' +
      '\t},\n' +
      '\t"categories": {}\n' +
      '}\n';
    await writeFile(file, text);
    const doc = await ConfigDocument.load(file);
    assert.equal(doc.indent, '\t');
    doc.update({
      agents: { oracle: { model: 'new' } },
      categories: { general: { model: 'cat' } },
    });
    const after = doc.render();
    assert.ok(after.includes('\t// comment'), 'untouched comment keeps tab');
    assert.ok(after.includes('\t"extraKey": 1,'), 'untouched key keeps tab');
    assert.ok(after.includes('\t\t\t"model": "new"'), 'inserted content uses tabs');
  });

  it('inserts missing agents and categories at the end with the document indent', async (t) => {
    const dir = await temporaryDirectory(t);
    const file = join(dir, 'config.jsonc');
    await writeFile(file, '{\n  "extraKey": 1\n}\n');
    const doc = await ConfigDocument.load(file);
    doc.update({
      agents: { oracle: { model: 'new' } },
      categories: { general: { model: 'cat' } },
    });
    const after = doc.render();
    assert.ok(after.includes('  "agents": {'), 'agents inserted with indent');
    assert.ok(after.includes('  "categories": {'), 'categories inserted with indent');
    const extra = after.indexOf('"extraKey"');
    const agents = after.indexOf('"agents"');
    const categories = after.indexOf('"categories"');
    assert.ok(extra < agents && agents < categories, 'inserted after existing keys');
  });

  it('re-parses cleanly when both agents and categories were missing', async (t) => {
    const dir = await temporaryDirectory(t);
    const file = join(dir, 'config.jsonc');
    await writeFile(file, '{\n  "extraKey": 1\n}\n');
    const doc = await ConfigDocument.load(file);
    doc.update({ agents: { oracle: { model: 'new' } }, categories: {} });
    const after = doc.render();
    assert.doesNotThrow(() => parseJsonc(after), 'rendered output re-parses');
    const parsed = parseJsonc(after).value;
    assert.deepEqual(parsed.agents, { oracle: { model: 'new' } });
    assert.deepEqual(parsed.categories, {});
    assert.equal(parsed.extraKey, 1);
  });

  it('keeps a plain .json config strict JSON after an update', async (t) => {
    const dir = await temporaryDirectory(t);
    const file = join(dir, 'config.json');
    await writeFile(
      file,
      '{\n  "$schema": "x",\n  "agents": {"oracle": {"model": "old"}},\n  "categories": {}\n}\n',
    );
    const doc = await ConfigDocument.load(file);
    assert.equal(doc.format, 'json');
    doc.update({ agents: { oracle: { model: 'new' } }, categories: {} });
    const after = doc.render();
    assert.doesNotThrow(() => JSON.parse(after), 'output is strict JSON');
    assert.ok(!after.includes('//'), 'no comments introduced');
    assert.ok(after.includes('"$schema": "x"'), 'other top-level key preserved');
  });

  it('re-applies a leading BOM on render', async (t) => {
    const dir = await temporaryDirectory(t);
    const file = join(dir, 'config.jsonc');
    await writeFile(file, '\uFEFF{\n  "agents": {},\n  "categories": {}\n}\n');
    const doc = await ConfigDocument.load(file);
    assert.equal(doc.hasBom, true);
    doc.update({ agents: { oracle: { model: 'new' } }, categories: {} });
    const after = doc.render();
    assert.ok(after.startsWith('\uFEFF'), 'output starts with BOM');
  });

  it('save() writes atomically and reloads with the updated value', async (t) => {
    const dir = await temporaryDirectory(t);
    const file = join(dir, 'config.jsonc');
    await writeFile(file, '{\n  "agents": {"oracle": {"model": "old"}},\n  "categories": {}\n}\n');
    const doc = await ConfigDocument.load(file);
    doc.update({ agents: { oracle: { model: 'new' } }, categories: {} });
    const rendered = doc.render();
    const saved = await doc.save();
    assert.equal(saved, file);
    assert.equal(await readFile(file, 'utf8'), rendered);
    const reloaded = await ConfigDocument.load(file);
    assert.deepEqual(reloaded.value.agents, { oracle: { model: 'new' } });
  });

  it('wraps malformed JSONC into a ConfigParseError naming the file and position', async (t) => {
    const dir = await temporaryDirectory(t);
    const file = join(dir, 'config.jsonc');
    await writeFile(file, '{\n  "agents": {\n    "oracle": {\n      "model": "oops\n    }\n  }\n}\n');
    await assert.rejects(ConfigDocument.load(file), (err) => {
      assert.ok(err instanceof ConfigParseError, 'is a ConfigParseError');
      assert.ok(err.message.includes(file), 'message names the file');
      assert.ok(err.message.includes('Line '), 'message has a line');
      assert.ok(err.message.includes('column'), 'message has a column');
      assert.equal(err.path, file);
      assert.equal(typeof err.line, 'number');
      assert.equal(typeof err.column, 'number');
      return true;
    });
  });
});

describe('ConfigDocument.update', () => {
  it('deep-clones incoming values so caller mutation cannot leak in', async (t) => {
    const dir = await temporaryDirectory(t);
    const file = join(dir, 'config.jsonc');
    await writeFile(file, '{\n  "agents": {},\n  "categories": {}\n}\n');
    const doc = await ConfigDocument.load(file);
    const orig = { oracle: { model: 'm', nested: { deep: true } } };
    doc.update({ agents: orig });
    orig.oracle.model = 'mutated';
    orig.oracle.nested.deep = false;
    assert.deepEqual(doc.value.agents, { oracle: { model: 'm', nested: { deep: true } } });
  });

  it('supports repeated updates operating on the latest state', async (t) => {
    const dir = await temporaryDirectory(t);
    const file = join(dir, 'config.jsonc');
    await writeFile(file, '{\n  "agents": {},\n  "categories": {}\n}\n');
    const doc = await ConfigDocument.load(file);
    doc.update({ agents: { a: 1 }, categories: {} });
    doc.update({ agents: { b: 2 }, categories: { c: 3 } });
    assert.deepEqual(doc.value.agents, { b: 2 });
    assert.deepEqual(doc.value.categories, { c: 3 });
  });
});

describe('loadOmoConfig', () => {
  it('loads a working document from an explicit path', async (t) => {
    const dir = await temporaryDirectory(t);
    const file = join(dir, 'config.jsonc');
    await writeFile(file, '{\n  "agents": {"oracle": {"model": "x"}},\n  "categories": {}\n}\n');
    const doc = await loadOmoConfig({ explicitPath: file });
    assert.equal(doc.path, file);
    assert.deepEqual(doc.value.agents, { oracle: { model: 'x' } });
  });

  it('throws ConfigNotFoundError when no config exists anywhere', async (t) => {
    const dir = await temporaryDirectory(t);
    const missing = join(dir, 'no-such-config.jsonc');
    await assert.rejects(loadOmoConfig({ explicitPath: missing }), (err) => {
      assert.equal(err.name, 'ConfigNotFoundError');
      return true;
    });
  });
});