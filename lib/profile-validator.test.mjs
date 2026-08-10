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
