import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { constants } from 'node:fs';

import { checkPermissions } from './permissions.mjs';

describe('checkPermissions (injectable)', () => {
  const ctx = {
    profilesDir: '/profiles',
    discovery: { path: '/config/oh-my-openagent.json' },
    configDir: '/config',
  };

  it('fails when profile directory is not writable', async () => {
    const deps = {
      stat: async (p) => ({ isDirectory: () => p === '/profiles' }),
      access: async (p, mode) => {
        if (p === '/profiles' && mode === constants.W_OK) {
          const e = new Error('EACCES');
          e.code = 'EACCES';
          throw e;
        }
      },
    };

    const results = await checkPermissions(ctx, deps);
    const check = results.find((c) => c.id === 'storage.profiles');
    assert.equal(check.status, 'fail');
    assert.ok(check.message.includes('not writable'));
  });

  it('fails when config directory is not writable', async () => {
    const deps = {
      stat: async (p) => ({ isDirectory: () => p === '/profiles' }),
      access: async (p, mode) => {
        if (p === '/config' && mode === constants.W_OK) {
          const e = new Error('EACCES');
          e.code = 'EACCES';
          throw e;
        }
      },
    };

    const results = await checkPermissions(ctx, deps);
    const check = results.find((c) => c.id === 'storage.atomic');
    assert.equal(check.status, 'fail');
    assert.ok(check.message.includes('Atomic writes not supported'));
  });
});
