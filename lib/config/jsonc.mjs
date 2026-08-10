/**
 * TEMPORARY verification stub for the JSONC engine.
 *
 * Implements the documented contract so the integration suite can be
 * exercised while the real engine agent's file is pending. NOT the
 * deliverable — removed after verification.
 */

export class JsoncSyntaxError extends Error {
  constructor(message, line, column) {
    super(message);
    this.name = 'JsoncSyntaxError';
    this.line = line;
    this.column = column;
  }
}

function buildLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function offsetToPosition(offset, lineStarts) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - lineStarts[lo] + 1 };
}

function isWhitespace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function isTrailingComma(text, start) {
  const n = text.length;
  let i = start;
  while (i < n) {
    const c = text[i];
    if (isWhitespace(c)) { i++; continue; }
    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n' && text[i] !== '\r') i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      let closed = false;
      while (i < n) {
        if (text[i] === '*' && text[i + 1] === '/') { i += 2; closed = true; break; }
        i++;
      }
      if (!closed) return false;
      continue;
    }
    return c === '}' || c === ']';
  }
  return false;
}

function cleanJsonc(text) {
  const lineStarts = buildLineStarts(text);
  const fail = (message, offset) => {
    const { line, column } = offsetToPosition(offset, lineStarts);
    throw new JsoncSyntaxError(message, line, column);
  };

  const out = [];
  const n = text.length;
  let i = 0;
  let depth = 0;
  const openStack = [];
  let rootDone = false;

  while (i < n) {
    const ch = text[i];

    if (rootDone) {
      if (isWhitespace(ch)) { out.push(ch); i++; continue; }
      if (ch === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
        // fall through to comment handling
      } else {
        fail('Trailing garbage after root value', i);
      }
    }

    if (ch === '"') {
      const strStart = i;
      out.push(ch);
      i++;
      let closed = false;
      while (i < n) {
        const c = text[i];
        const cc = text.charCodeAt(i);
        if (c === '"') { out.push(c); i++; closed = true; break; }
        if (c === '\\') {
          out.push(c); i++;
          if (i >= n) break;
          out.push(text[i]); i++;
          continue;
        }
        if (cc < 0x20) fail('Bad control character in string literal', i);
        out.push(c); i++;
      }
      if (!closed) fail('Unterminated string', strStart);
      continue;
    }

    if (ch === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n' && text[i] !== '\r') {
        out.push(' '); i++;
      }
      continue;
    }

    if (ch === '/' && text[i + 1] === '*') {
      const commentStart = i;
      out.push(' '); out.push(' '); i += 2;
      let closed = false;
      while (i < n) {
        const c = text[i];
        if (c === '*' && text[i + 1] === '/') {
          out.push(' '); out.push(' '); i += 2; closed = true; break;
        }
        if (c === '\n' || c === '\r') { out.push(c); i++; }
        else { out.push(' '); i++; }
      }
      if (!closed) fail('Unterminated block comment', commentStart);
      continue;
    }

    if (ch === ',') {
      if (isTrailingComma(text, i + 1)) out.push(' ');
      else out.push(ch);
      i++;
      continue;
    }

    if (ch === '{' || ch === '[') {
      depth++;
      openStack.push(i);
      out.push(ch); i++;
      continue;
    }

    if (ch === '}' || ch === ']') {
      if (depth === 0) {
        out.push(ch); i++;
        continue;
      }
      depth--;
      openStack.pop();
      if (depth === 0) rootDone = true;
      out.push(ch); i++;
      continue;
    }

    out.push(ch); i++;
  }

  if (openStack.length > 0) {
    const pos = openStack[openStack.length - 1];
    fail(`Unclosed ${text[pos] === '{' ? 'object' : 'array'}`, pos);
  }

  return { cleaned: out.join(''), lineStarts };
}

export function parseJsonc(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.trim() === '') {
    throw new JsoncSyntaxError('Empty input', 1, 1);
  }
  const { cleaned, lineStarts } = cleanJsonc(text);
  if (cleaned.trim() === '') {
    throw new JsoncSyntaxError('Empty input', 1, 1);
  }
  try {
    const value = JSON.parse(cleaned);
    return { value };
  } catch (err) {
    const m = /position (\d+)/.exec(err.message);
    if (m) {
      const { line, column } = offsetToPosition(Number(m[1]), lineStarts);
      throw new JsoncSyntaxError(err.message.replace(/ in JSON at position \d+$/, ''), line, column);
    }
    throw new JsoncSyntaxError(err.message, 1, 1);
  }
}

export function detectIndent(text) {
  const counts = new Map();
  const lines = text.split(/\r\n|\r|\n/);
  for (let li = 1; li < lines.length; li++) {
    const line = lines[li];
    if (line.trim() === '') continue;
    const m = /^[ \t]*/.exec(line);
    const ws = m[0];
    if (ws === '') continue;
    counts.set(ws, (counts.get(ws) ?? 0) + 1);
  }
  let best = '  ';
  let bestCount = 0;
  for (const [ws, count] of counts) {
    if (count > bestCount) { best = ws; bestCount = count; }
  }
  return best;
}

export function detectNewline(text) {
  const idx = text.indexOf('\n');
  if (idx === -1) return '\n';
  if (idx > 0 && text[idx - 1] === '\r') return '\r\n';
  return '\n';
}

export function serializeValue(value, indent) {
  return JSON.stringify(value, null, indent);
}

// ---------------------------------------------------------------------------
// replaceRootProperty helpers
// ---------------------------------------------------------------------------

function skipWsAndComments(text, start, end) {
  let i = start;
  while (i < end) {
    const c = text[i];
    if (isWhitespace(c)) { i++; continue; }
    if (c === '/' && text[i + 1] === '/') {
      while (i < end && text[i] !== '\n' && text[i] !== '\r') i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < end && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    break;
  }
  return i;
}

function nextSignificant(text, start, end) {
  const i = skipWsAndComments(text, start, end);
  return i < end ? text[i] : null;
}

function scanString(text, start, end) {
  let i = start + 1;
  while (i < end) {
    if (text[i] === '\\') { i += 2; continue; }
    if (text[i] === '"') return i + 1;
    i++;
  }
  return i;
}

function scanValue(text, start, end) {
  let i = start;
  let depth = 0;
  while (i < end) {
    const c = text[i];
    if (c === '"') {
      i = scanString(text, i, end);
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < end && text[i] !== '\n' && text[i] !== '\r') i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < end && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '{' || c === '[') { depth++; i++; continue; }
    if (c === '}' || c === ']') {
      if (depth === 0) return i;
      depth--;
      i++;
      if (depth === 0) return i;
      continue;
    }
    if (c === ',' && depth === 0) return i;
    i++;
  }
  return i;
}

/**
 * Re-indent the continuation lines of a multi-line serialized value so it
 * nests under the property it is inserted at. The first line is left as-is
 * (it follows `"name": ` on the same line).
 *
 * @param {string} text
 * @param {string} indent
 * @returns {string}
 */
function indentContinuation(text, indent) {
  const nl = text.indexOf('\n');
  if (nl === -1) return text;
  return text.slice(0, nl) + text.slice(nl).replace(/\n/g, '\n' + indent);
}

export function replaceRootProperty(text, name, newValueText, { indent = '  ' } = {}) {
  const lineStarts = buildLineStarts(text);
  const fail = (message, offset) => {
    const { line, column } = offsetToPosition(offset, lineStarts);
    throw new JsoncSyntaxError(message, line, column);
  };

  const n = text.length;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  i = skipWsAndComments(text, i, n);
  if (i >= n || text[i] !== '{') {
    fail('Root value must be an object', i);
  }
  const rootOpen = i;

  // find matching closing brace
  let depth = 0;
  let closeIdx = -1;
  let j = rootOpen;
  while (j < n) {
    const c = text[j];
    if (c === '"') { j = scanString(text, j, n); continue; }
    if (c === '/' && text[j + 1] === '/') {
      while (j < n && text[j] !== '\n' && text[j] !== '\r') j++;
      continue;
    }
    if (c === '/' && text[j + 1] === '*') {
      j += 2;
      while (j < n && !(text[j] === '*' && text[j + 1] === '/')) j++;
      j += 2;
      continue;
    }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) { closeIdx = j; break; }
    }
    j++;
  }
  if (closeIdx === -1) fail('Unclosed object', rootOpen);

  // scan members
  let k = rootOpen + 1;
  let memberCount = 0;
  let lastMemberValueEnd = -1;
  let trailingComma = false;
  let foundStart = -1;
  let foundEnd = -1;

  while (k < closeIdx) {
    k = skipWsAndComments(text, k, closeIdx);
    if (k >= closeIdx) break;
    const c = text[k];
    if (c === '}') break;
    if (c === ',') {
      if (nextSignificant(text, k + 1, closeIdx + 1) === '}') { trailingComma = true; break; }
      k++;
      continue;
    }
    if (c !== '"') {
      fail('Unexpected token in object', k);
    }
    const keyEnd = scanString(text, k, closeIdx);
    const key = JSON.parse(text.slice(k, keyEnd));
    const colonPos = skipWsAndComments(text, keyEnd, closeIdx);
    if (colonPos >= closeIdx || text[colonPos] !== ':') {
      fail('Expected ":" after property name', colonPos);
    }
    const vs = skipWsAndComments(text, colonPos + 1, closeIdx);
    if (vs >= closeIdx) {
      fail('Expected value', vs);
    }
    const isContainer = text[vs] === '{' || text[vs] === '[';
    const ve = scanValue(text, vs, closeIdx);
    let valueEndPos;
    if (isContainer) {
      valueEndPos = ve;
    } else {
      valueEndPos = ve;
      while (valueEndPos > vs && isWhitespace(text[valueEndPos - 1])) valueEndPos--;
    }
    memberCount++;
    lastMemberValueEnd = valueEndPos;
    if (key === name) {
      foundStart = vs;
      foundEnd = valueEndPos;
    }
    k = ve;
    if (k < closeIdx && text[k] === ',') {
      if (nextSignificant(text, k + 1, closeIdx + 1) === '}') { trailingComma = true; break; }
      k++;
    }
  }

  if (foundStart !== -1) {
    return text.slice(0, foundStart) + indentContinuation(newValueText, indent) + text.slice(foundEnd);
  }

  const newline = detectNewline(text);
  if (memberCount === 0) {
    return text.slice(0, rootOpen + 1) + newline + indent + `"${name}": ${indentContinuation(newValueText, indent)}` + text.slice(rootOpen + 1);
  }
  if (trailingComma) {
    const before = text.slice(0, closeIdx);
    const endsWithNewline = /(?:\r\n|\r|\n)$/.test(before);
    const insert = (endsWithNewline ? '' : newline) + indent + `"${name}": ${indentContinuation(newValueText, indent)}`;
    return before + insert + text.slice(closeIdx);
  }
  const withComma = text.slice(0, lastMemberValueEnd) + ',' + text.slice(lastMemberValueEnd);
  const closeIdx2 = closeIdx + 1;
  const before2 = withComma.slice(0, closeIdx2);
  const endsWithNewline = /(?:\r\n|\r|\n)$/.test(before2);
  const insert = (endsWithNewline ? '' : newline) + indent + `"${name}": ${indentContinuation(newValueText, indent)}`;
  return before2 + insert + withComma.slice(closeIdx2);
}