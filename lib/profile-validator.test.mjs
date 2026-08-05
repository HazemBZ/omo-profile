/**
 * Tests for profile-validator.mjs
 *
 * Pure unit tests, no filesystem access.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateProfile,
  validateModelEntry,
  modelEntryEqual,
  configMatchesProfile,
} from './profile-validator.mjs';

// ---------------------------------------------------------------------------
// Valid fixtures
// ---------------------------------------------------------------------------
const validAgentEntry = () => ({
  model: 'opencode/deepseek-v4-flash-free',
  variant: 'default',
  fallback_models: [],
});

function fullValidProfile() {
  const agents = {};
  for (const name of ['hephaestus','oracle','librarian','explore',
    'multimodal-looker','prometheus','metis','momus','atlas',
    'sisyphus-junior','sisyphus']) {
    agents[name] = validAgentEntry();
  }
  const categories = {};
  for (const name of ['visual-engineering','ultrabrain','deep','artistry',
    'quick','unspecified-low','unspecified-high','writing']) {
    categories[name] = validAgentEntry();
  }
  return { metadata: { name: 'test', description: 'test profile' }, agents, categories };
}

// ---------------------------------------------------------------------------
// validateModelEntry
// ---------------------------------------------------------------------------
describe('validateModelEntry', () => {
  it('accepts a complete valid entry', () => {
    assert.deepEqual(validateModelEntry(validAgentEntry(), 'x'), []);
  });

  it('accepts minimal entry (model only)', () => {
    assert.deepEqual(validateModelEntry({ model: 'p/a' }, 'x'), []);
  });

  it('rejects null/undefined', () => {
    const e = validateModelEntry(null, 'x');
    assert.ok(e.some(m => m.startsWith('x must be a non-null object')));
  });

  it('rejects missing model', () => {
    const e = validateModelEntry({ variant: 'default' }, 'x');
    assert.ok(e.some(m => m.includes('.model must be a non-empty string')));
  });

  it('rejects empty model string', () => {
    const e = validateModelEntry({ model: '' }, 'x');
    assert.ok(e.some(m => m.includes('.model must be a non-empty string')));
  });

  it('rejects bad variant type', () => {
    const e = validateModelEntry({ model: 'p/a', variant: 42 }, 'x');
    assert.ok(e.some(m => m.includes('.variant must be a non-empty string')));
  });

  it('rejects fallback_models not an array', () => {
    const e = validateModelEntry({ model: 'p/a', fallback_models: 'oops' }, 'x');
    assert.ok(e.some(m => m.includes('.fallback_models must be an array')));
  });

  it('validates each fallback entry', () => {
    const entry = {
      model: 'p/a',
      fallback_models: [{ model: 'p/b' }, { model: '' }],
    };
    const e = validateModelEntry(entry, 'x');
    assert.ok(e.some(m => m.includes('fallback_models[1].model must be a non-empty string')));
  });
});

// ---------------------------------------------------------------------------
// validateProfile
// ---------------------------------------------------------------------------
describe('validateProfile', () => {
  it('accepts a full valid profile', () => {
    const r = validateProfile(fullValidProfile());
    assert.equal(r.valid, true);
    assert.deepEqual(r.errors, []);
  });

  it('rejects null', () => {
    const r = validateProfile(null);
    assert.equal(r.valid, false);
  });

  it('rejects array', () => {
    const r = validateProfile([]);
    assert.equal(r.valid, false);
  });

  it('rejects missing agents key', () => {
    const p = fullValidProfile();
    delete p.agents;
    const r = validateProfile(p);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('agents must be a non-null object')));
  });

  it('rejects missing categories key', () => {
    const p = fullValidProfile();
    delete p.categories;
    const r = validateProfile(p);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('categories must be a non-null object')));
  });

  it('detects missing agents', () => {
    const p = fullValidProfile();
    delete p.agents.sisyphus;
    const r = validateProfile(p);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('agents missing: sisyphus')));
  });

  it('detects missing categories', () => {
    const p = fullValidProfile();
    delete p.categories.writing;
    const r = validateProfile(p);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('categories missing: writing')));
  });

  it('detects unexpected agents', () => {
    const p = fullValidProfile();
    p.agents.extraGuy = validAgentEntry();
    const r = validateProfile(p);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('unexpected agents: extraGuy')));
  });

  it('collects multiple errors', () => {
    const p = fullValidProfile();
    delete p.agents.oracle;
    delete p.agents.sisyphus;
    delete p.categories.ultrabrain;
    p.agents.bogus = { model: '' };
    const r = validateProfile(p);
    assert.equal(r.valid, false);
    assert.ok(r.errors.length >= 3);
  });
});

// ---------------------------------------------------------------------------
// modelEntryEqual
// ---------------------------------------------------------------------------
describe('modelEntryEqual', () => {
  const a = { model: 'p/x', variant: 'default', fallback_models: [{ model: 'p/y' }] };

  it('equal when same', () => {
    assert.ok(modelEntryEqual(a, { model: 'p/x', variant: 'default', fallback_models: [{ model: 'p/y' }] }));
  });

  it('different model', () => {
    assert.equal(modelEntryEqual(a, { model: 'p/z', variant: 'default' }), false);
  });

  it('falls back variant to default', () => {
    assert.ok(modelEntryEqual({ model: 'p/x' }, { model: 'p/x', variant: 'default' }));
  });

  it('null/undefined', () => {
    assert.equal(modelEntryEqual(null, a), false);
    assert.equal(modelEntryEqual(a, undefined), false);
  });
});

// ---------------------------------------------------------------------------
// configMatchesProfile
// ---------------------------------------------------------------------------
describe('configMatchesProfile', () => {
  const profile = fullValidProfile();

  it('matches when identical', () => {
    const config = { agents: { ...profile.agents }, categories: { ...profile.categories } };
    assert.ok(configMatchesProfile(config, profile));
  });

  it('does not match when one agent differs', () => {
    const config = { agents: { ...profile.agents }, categories: { ...profile.categories } };
    config.agents.sisyphus = { model: 'different/model', variant: 'default' };
    assert.equal(configMatchesProfile(config, profile), false);
  });

  it('null guards', () => {
    assert.equal(configMatchesProfile(null, profile), false);
    assert.equal(configMatchesProfile(profile, null), false);
  });
});
