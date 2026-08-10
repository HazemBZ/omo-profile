/**
 * Tests for the JSONC engine (lib/config/jsonc.mjs).
 *
 * Covers the full engine contract: parsing (comments, trailing commas,
 * strings with comment-like content, BOM, CRLF), indentation/newline
 * detection, and byte-preserving root-property replacement.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  JsoncSyntaxError,
  parseJsonc,
  detectIndent,
  detectNewline,
  serializeValue,
  replaceRootProperty,
} from './jsonc.mjs'

describe('parseJsonc', () => {
  it('parses plain JSON', () => {
    const { value } = parseJsonc('{"a": 1, "b": [true, null]}')
    assert.deepEqual(value, { a: 1, b: [true, null] })
  })

  it('parses line comments (own line and inline)', () => {
    const { value } = parseJsonc('{ // top\n  "a": 1, // inline\n  "b": 2\n}')
    assert.deepEqual(value, { a: 1, b: 2 })
  })

  it('parses block comments incl. multi-line', () => {
    const { value } = parseJsonc('{ /* one */ "a": /* two\nlines */ 1 }')
    assert.deepEqual(value, { a: 1 })
  })

  it('parses trailing commas in objects and arrays', () => {
    const { value } = parseJsonc('{ "a": [1, 2,], "b": { "c": 3, }, }')
    assert.deepEqual(value, { a: [1, 2], b: { c: 3 } })
  })

  it('parses nested structures with comments at every level', () => {
    const text = [
      '{',
      '  "agents": { // agent block',
      '    "oracle": {',
      '      /* nested */ "model": "x",',
      '    },',
      '  },',
      '  "categories": {',
      '    "general": [', // array
      '      "a", "b",',
      '    ],',
      '  },',
      '}',
    ].join('\n')
    const { value } = parseJsonc(text)
    assert.equal(value.agents.oracle.model, 'x')
    assert.deepEqual(value.categories.general, ['a', 'b'])
  })

  it('leaves comment-like content inside strings untouched', () => {
    const { value } = parseJsonc('{ "url": "http://x.com", "code": "/* not a comment */", "q": "a//b\\\\c" }')
    assert.equal(value.url, 'http://x.com')
    assert.equal(value.code, '/* not a comment */')
  })

  it('tolerates a leading BOM', () => {
    const { value } = parseJsonc('\uFEFF{ "a": 1 }')
    assert.deepEqual(value, { a: 1 })
  })

  describe('malformed input', () => {
    function throwsWithPosition(text, label) {
      try {
        parseJsonc(text)
        assert.fail(`${label}: expected JsoncSyntaxError`)
      } catch (err) {
        assert.ok(err instanceof JsoncSyntaxError, `${label}: got ${err.constructor.name}`)
        assert.equal(typeof err.line, 'number', `${label}: line not a number`)
        assert.equal(typeof err.column, 'number', `${label}: column not a number`)
        assert.ok(err.line >= 1 && err.column >= 1, `${label}: ${err.line}:${err.column}`)
      }
    }

    it('unterminated string', () => throwsWithPosition('{ "a": "oops }', 'unterminated string'))
    it('unclosed object', () => throwsWithPosition('{ "a": 1', 'unclosed object'))
    it('unexpected token (unquoted key)', () => throwsWithPosition('{ a: 1 }', 'unquoted key'))
    it('trailing garbage after root', () => throwsWithPosition('{ "a": 1 } extra', 'trailing garbage'))
    it('empty input', () => throwsWithPosition('', 'empty'))
    it('whitespace-only input', () => throwsWithPosition('   \n  ', 'whitespace only'))
    it('unterminated block comment', () => throwsWithPosition('{ "a": 1 } /* oops', 'unterminated block comment'))
  })
})

describe('detectIndent', () => {
  it('detects 2-space indent', () => {
    assert.equal(detectIndent('{\n  "a": 1,\n  "b": 2\n}'), '  ')
  })

  it('detects 4-space indent', () => {
    assert.equal(detectIndent('{\n    "a": 1\n}'), '    ')
  })

  it('detects tab indent', () => {
    assert.equal(detectIndent('{\n\t"a": 1,\n\t"b": 2\n}'), '\t')
  })

  it('defaults to two spaces when nothing is indented', () => {
    assert.equal(detectIndent('{"a":1}'), '  ')
  })
})

describe('detectNewline', () => {
  it('detects LF', () => {
    assert.equal(detectNewline('{\n  "a": 1\n}'), '\n')
  })

  it('detects CRLF', () => {
    assert.equal(detectNewline('{\r\n  "a": 1\r\n}'), '\r\n')
  })

  it('defaults to LF', () => {
    assert.equal(detectNewline('{"a":1}'), '\n')
  })
})

describe('serializeValue', () => {
  it('matches JSON.stringify output', () => {
    const value = { a: 1, b: ['x', 'y'] }
    assert.equal(serializeValue(value, '  '), JSON.stringify(value, null, '  '))
    assert.equal(serializeValue(value, '\t'), JSON.stringify(value, null, '\t'))
  })
})

describe('replaceRootProperty', () => {
  it('replaces an existing property, preserving all other bytes', () => {
    const before = '{\n  // keep\n  "agents": { "old": true },\n  "extraKey": 1,\n}\n'
    const after = replaceRootProperty(before, 'agents', '{"new": true}', { indent: '  ' })
    assert.ok(after.includes('"agents": {"new": true}'), after)
    assert.ok(after.includes('// keep'), after)
    assert.ok(after.includes('"extraKey": 1'), after)
    assert.ok(!after.includes('"old": true'), after)
    parseJsonc(after) // re-parses
  })

  it('inserts a missing property at the end (no trailing comma present)', () => {
    const before = '{\n  "a": 1\n}\n'
    const after = replaceRootProperty(before, 'agents', '{}', { indent: '  ' })
    assert.ok(after.includes('"a": 1,\n  "agents": {}'), after)
    parseJsonc(after)
  })

  it('inserts a missing property without creating a double comma when a trailing comma exists', () => {
    const before = '{\n  "a": 1,\n}\n'
    const after = replaceRootProperty(before, 'agents', '{}', { indent: '  ' })
    assert.ok(!after.includes(',,'), after)
    assert.ok(after.includes('"a": 1,\n  "agents": {}'), after)
    parseJsonc(after)
  })

  it('inserts after an existing last object property (byte around untouched)', () => {
    const before = '{\n  "agents": { "x": 1 }\n}\n'
    const after = replaceRootProperty(before, 'categories', '{}', { indent: '  ' })
    assert.ok(after.includes('"agents": { "x": 1 },\n  "categories": {}'), after)
    parseJsonc(after)
  })

  it('keeps a tabs-indented file tabs-indented', () => {
    const before = '{\n\t"a": 1\n}\n'
    const after = replaceRootProperty(before, 'agents', '{\n\t"m": "x"\n}', { indent: '\t' })
    assert.ok(after.includes('\t"agents": {\n\t\t"m": "x"\n\t}'), after)
    assert.ok(!after.includes('  "'), after)
    parseJsonc(after)
  })

  it('keeps CRLF line endings in untouched regions', () => {
    const before = '{\r\n  "a": 1\r\n}\r\n'
    const after = replaceRootProperty(before, 'agents', '{}', { indent: '  ' })
    assert.equal(detectNewline(after), '\r\n')
    assert.ok(after.includes('\r\n'), after)
    parseJsonc(after)
  })

  it('throws when the root value is not an object', () => {
    assert.throws(() => replaceRootProperty('[1, 2]', 'a', '{}', {}), JsoncSyntaxError)
    assert.throws(() => replaceRootProperty('"str"', 'a', '{}', {}), JsoncSyntaxError)
    assert.throws(() => replaceRootProperty('42', 'a', '{}', {}), JsoncSyntaxError)
  })

  it('round-trips a realistic config with comments and trailing commas', () => {
    const before = [
      '// Top comment',
      '{',
      '  "$schema": "https://example.com/schema.json",',
      '  "agents": {',
      '    "oracle": {',
      '      "model": "old",',
      '    },',
      '  },',
      '}',
      '',
    ].join('\n')
    const serialized = serializeValue({ oracle: { model: 'new' } }, '  ')
    const after = replaceRootProperty(before, 'agents', serialized, { indent: '  ' })
    assert.ok(after.includes('// Top comment'), after)
    assert.ok(after.includes('"model": "new"'), after)
    assert.ok(!after.includes('"model": "old"'), after)
    const { value } = parseJsonc(after)
    assert.equal(value.agents.oracle.model, 'new')
    assert.equal(value.$schema, 'https://example.com/schema.json')
  })
})