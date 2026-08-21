import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  OpencodeNotFoundError,
  getAvailableModels,
  isOpencodeInstalled,
  parseModelsOutput,
} from './models.mjs';

function enoentError() {
  const err = new Error('spawn opencode ENOENT');
  err.code = 'ENOENT';
  return err;
}

describe('parseModelsOutput', () => {
  it('splits, trims, and drops empty lines', () => {
    assert.deepEqual(parseModelsOutput('  opencode/deepseek-v4-pro\n\nopenai/gpt-5.4  \n'), [
      'opencode/deepseek-v4-pro',
      'openai/gpt-5.4',
    ]);
  });

  it('handles empty and whitespace-only input', () => {
    assert.deepEqual(parseModelsOutput(''), []);
    assert.deepEqual(parseModelsOutput('\n\n  \n'), []);
  });
});

describe('getAvailableModels', () => {
  it('returns parsed stdout on success', async () => {
    const exec = async () => ({ stdout: 'provider/a\nprovider/b\n' });
    assert.deepEqual(await getAvailableModels({ exec }), ['provider/a', 'provider/b']);
  });

  it('passes `models` args and a timeout', async () => {
    let seen;
    const exec = async (command, args, options) => {
      seen = { command, args, options };
      return { stdout: '' };
    };
    await getAvailableModels({ command: 'opencode-custom', exec, timeoutMs: 42 });
    assert.equal(seen.command, 'opencode-custom');
    assert.deepEqual(seen.args, ['models']);
    assert.equal(seen.options.timeout, 42);
  });

  it('throws OpencodeNotFoundError on ENOENT', async () => {
    const exec = async () => { throw enoentError(); };
    await assert.rejects(getAvailableModels({ command: 'nope', exec }), (err) => {
      assert.ok(err instanceof OpencodeNotFoundError);
      assert.equal(err.command, 'nope');
      assert.match(err.message, /`nope` executable not found/);
      return true;
    });
  });

  it('rethrows non-ENOENT errors unchanged', async () => {
    const boom = new Error('boom');
    const exec = async () => { throw boom; };
    await assert.rejects(getAvailableModels({ exec }), (err) => err === boom);
  });
});

describe('isOpencodeInstalled', () => {
  it('returns true on success', async () => {
    const exec = async () => ({ stdout: '1.18.18' });
    assert.equal(await isOpencodeInstalled({ exec }), true);
  });

  it('returns false on ENOENT', async () => {
    const exec = async () => { throw enoentError(); };
    assert.equal(await isOpencodeInstalled({ exec }), false);
  });

  it('returns true on non-ENOENT errors', async () => {
    const exec = async () => { throw new Error('some other error'); };
    assert.equal(await isOpencodeInstalled({ exec }), true);
  });

  it('passes --version with a timeout', async () => {
    let seen;
    const exec = async (command, args, options) => {
      seen = { command, args, options };
      return { stdout: '' };
    };
    await isOpencodeInstalled({ exec, timeoutMs: 7 });
    assert.equal(seen.command, 'opencode');
    assert.deepEqual(seen.args, ['--version']);
    assert.equal(seen.options.timeout, 7);
  });
});
