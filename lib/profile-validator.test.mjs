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
import { normalizeConfig } from './profile/normalize.mjs';
import { matchesProfile, profilesEqual } from './profile/compare.mjs';
import { diffProfiles } from './profile/diff.mjs';

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

  it('accepts an entry without model (partial override)', () => {
    assert.deepEqual(validateModelEntry({ variant: 'default' }, 'x'), []);
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

  it('accepts a profile without agents key (sparse)', () => {
    const p = fullValidProfile();
    delete p.agents;
    const r = validateProfile(p);
    assert.equal(r.valid, true);
  });

  it('accepts a profile without categories key (sparse)', () => {
    const p = fullValidProfile();
    delete p.categories;
    const r = validateProfile(p);
    assert.equal(r.valid, true);
  });

  it('accepts a subset of built-in agents', () => {
    const r = validateProfile({
      agents: { oracle: { model: 'openai/gpt-5.6-sol' } },
    });
    assert.equal(r.valid, true);
  });

  it('accepts a subset of built-in categories', () => {
    const r = validateProfile({
      categories: { ultrabrain: { model: 'openai/gpt-5.6-sol' } },
    });
    assert.equal(r.valid, true);
  });

  it('accepts custom agent names', () => {
    const p = fullValidProfile();
    p.agents.extraGuy = validAgentEntry();
    const r = validateProfile(p);
    assert.equal(r.valid, true);
  });

  it('accepts custom category names', () => {
    const r = validateProfile({
      categories: {
        git: { model: 'openai/gpt-5.6-sol' },
        cheap: { model: 'openai/gpt-5.4-mini' },
      },
    });
    assert.equal(r.valid, true);
  });

  it('accepts an agent without model (partial override)', () => {
    const r = validateProfile({ agents: { oracle: { temperature: 0.2 } } });
    assert.equal(r.valid, true);
  });

  it('accepts a category without model', () => {
    const r = validateProfile({
      categories: { 'visual-engineering': { temperature: 0.1 } },
    });
    assert.equal(r.valid, true);
  });

  it('accepts unknown agent properties', () => {
    const r = validateProfile({
      agents: {
        oracle: {
          model: 'openai/gpt-5.6-sol',
          temperature: 0.17,
          reasoningEffort: 'high',
          maxTokens: 16000,
          tools: { bash: false },
          someFutureOption: { enabled: true },
        },
      },
    });
    assert.equal(r.valid, true);
  });

  it('accepts unknown category properties', () => {
    const r = validateProfile({
      categories: { git: { model: 'openai/gpt-5.4-mini', temperature: 0.1 } },
    });
    assert.equal(r.valid, true);
  });

  it('accepts an empty profile (metadata only)', () => {
    const r = validateProfile({ metadata: { name: 'empty' } });
    assert.equal(r.valid, true);
  });

  it('rejects agents that is an array', () => {
    const p = fullValidProfile();
    p.agents = [];
    const r = validateProfile(p);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('agents must be a non-null object')));
  });

  it('rejects categories that is a string', () => {
    const p = fullValidProfile();
    p.categories = 'oops';
    const r = validateProfile(p);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('categories must be a non-null object')));
  });

  it('rejects a null agent entry', () => {
    const p = fullValidProfile();
    p.agents.oracle = null;
    const r = validateProfile(p);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('agents.oracle must be a non-null object')));
  });

  it('rejects malformed known fields', () => {
    const p = fullValidProfile();
    p.agents.oracle = { model: '' };
    p.categories.ultrabrain = { model: 'p/a', variant: 42 };
    const r = validateProfile(p);
    assert.equal(r.valid, false);
    assert.ok(r.errors.length >= 2);
  });

  it('collects multiple errors from entry-level problems', () => {
    const p = fullValidProfile();
    p.agents.oracle = { model: '' };
    p.categories.ultrabrain = { model: 42 };
    const r = validateProfile(p);
    assert.equal(r.valid, false);
    assert.ok(r.errors.length >= 2);
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

  it('does not invent omitted defaults', () => {
    assert.equal(modelEntryEqual({ model: 'p/x' }, { model: 'p/x', variant: 'default' }), false);
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

// ---------------------------------------------------------------------------
// Canonical profile comparison (P2)
// ---------------------------------------------------------------------------
describe('normalizeConfig', () => {
  it('sorts nested object keys without changing primitives or array order', () => {
    const normalized = normalizeConfig({
      z: true,
      a: { zebra: null, alpha: [2, 1, { b: 'two', a: 'one' }] },
      number: 0.2,
    });

    assert.deepEqual(normalized, {
      a: { alpha: [2, 1, { a: 'one', b: 'two' }], zebra: null },
      number: 0.2,
      z: true,
    });
  });
});

describe('profilesEqual', () => {
  it('ignores object key order at every depth', () => {
    assert.equal(profilesEqual(
      { model: 'foo', tools: { bash: false, edit: true } },
      { tools: { edit: true, bash: false }, model: 'foo' },
    ), true);
  });

  it('treats array order and unknown field values as significant', () => {
    assert.equal(profilesEqual(
      { fallback_models: ['provider/a', 'provider/b'], temperature: 0.1 },
      { fallback_models: ['provider/b', 'provider/a'], temperature: 0.1 },
    ), false);
    assert.equal(profilesEqual(
      { model: 'foo', reasoningEffort: 'high' },
      { model: 'foo', reasoningEffort: 'low' },
    ), false);
  });
});

describe('matchesProfile', () => {
  const profile = {
    agents: { oracle: { model: 'foo' } },
    categories: { custom: { model: 'bar' } },
  };

  it('ignores unrelated config entries but compares owned entries exactly', () => {
    const config = {
      agents: {
        oracle: { model: 'foo' },
        explore: { model: 'unrelated' },
      },
      categories: {
        custom: { model: 'bar' },
        quick: { model: 'unrelated' },
      },
    };

    assert.equal(matchesProfile(config, profile), true);
    assert.equal(matchesProfile({
      ...config,
      agents: { ...config.agents, oracle: { model: 'foo', temperature: 0.7 } },
    }, profile), false);
  });

  it('requires every profile-owned entry to exist', () => {
    assert.equal(matchesProfile({ agents: { oracle: { model: 'foo' } } }, profile), false);
  });
});

describe('diffProfiles', () => {
  it('returns deterministic leaf-level added, removed, and changed records', () => {
    assert.deepEqual(diffProfiles(
      {
        agents: { oracle: { model: 'old', variant: 'low' } },
        categories: { quick: { variant: 'low' } },
      },
      {
        agents: { oracle: { model: 'new', temperature: 0.2 } },
        categories: {},
      },
    ), [
      { path: 'agents.oracle.model', type: 'changed', before: 'old', after: 'new' },
      { path: 'agents.oracle.temperature', type: 'added', after: 0.2 },
      { path: 'agents.oracle.variant', type: 'removed', before: 'low' },
      { path: 'categories.quick.variant', type: 'removed', before: 'low' },
    ]);
  });

  it('returns no changes for reordered objects and reports array changes', () => {
    assert.deepEqual(diffProfiles(
      { agents: { oracle: { model: 'foo', tools: { bash: true, edit: false } } } },
      { agents: { oracle: { tools: { edit: false, bash: true }, model: 'foo' } } },
    ), []);
    assert.deepEqual(diffProfiles(
      { fallback_models: ['provider/a', 'provider/b'] },
      { fallback_models: ['provider/b', 'provider/a'] },
    ), [{
      path: 'fallback_models',
      type: 'changed',
      before: ['provider/a', 'provider/b'],
      after: ['provider/b', 'provider/a'],
    }]);
  });

  it('encodes special keys without colliding with nested simple paths', () => {
    assert.deepEqual(diffProfiles(
      { agents: { oracle: { model: 'nested-old' }, 'oracle.model': 'flat-old' } },
      { agents: { oracle: { model: 'nested-new' }, 'oracle.model': 'flat-new' } },
    ), [
      { path: 'agents.oracle.model', type: 'changed', before: 'nested-old', after: 'nested-new' },
      { path: 'agents["oracle.model"]', type: 'changed', before: 'flat-old', after: 'flat-new' },
    ]);
  });
});
