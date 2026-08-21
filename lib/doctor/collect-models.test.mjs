import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { collectModels } from './collect-models.mjs';

describe('collectModels', () => {
  it('collects an agent model', () => {
    assert.deepEqual(collectModels({ agents: { oracle: { model: 'provider/a' } } }), [
      { model: 'provider/a', paths: ['agents.oracle.model'] },
    ]);
  });

  it('collects a category model', () => {
    assert.deepEqual(collectModels({ categories: { deep: { model: 'provider/b' } } }), [
      { model: 'provider/b', paths: ['categories.deep.model'] },
    ]);
  });

  it('collects a string fallback_models', () => {
    assert.deepEqual(collectModels({ agents: { oracle: { fallback_models: 'provider/c' } } }), [
      { model: 'provider/c', paths: ['agents.oracle.fallback_models'] },
    ]);
  });

  it('collects an array fallback_models', () => {
    assert.deepEqual(
      collectModels({ agents: { oracle: { fallback_models: ['provider/c', 'provider/d'] } } }),
      [
        { model: 'provider/c', paths: ['agents.oracle.fallback_models[0]'] },
        { model: 'provider/d', paths: ['agents.oracle.fallback_models[1]'] },
      ],
    );
  });

  it('collects an object fallback_models', () => {
    assert.deepEqual(collectModels({ agents: { oracle: { fallback_models: { model: 'provider/e' } } } }), [
      { model: 'provider/e', paths: ['agents.oracle.fallback_models.model'] },
    ]);
  });

  it('collects a mixed fallback array (string + object)', () => {
    const config = {
      agents: {
        oracle: {
          model: 'provider/a',
          fallback_models: ['provider/b', { model: 'provider/c' }],
        },
      },
    };
    assert.deepEqual(collectModels(config), [
      { model: 'provider/a', paths: ['agents.oracle.model'] },
      { model: 'provider/b', paths: ['agents.oracle.fallback_models[0]'] },
      { model: 'provider/c', paths: ['agents.oracle.fallback_models[1].model'] },
    ]);
  });

  it('deduplicates duplicate models while retaining all paths', () => {
    const config = {
      agents: {
        oracle: { model: 'provider/x' },
        explore: { model: 'provider/x' },
      },
      categories: {
        deep: { fallback_models: ['provider/x'] },
      },
    };
    assert.deepEqual(collectModels(config), [
      { model: 'provider/x', paths: ['agents.oracle.model', 'agents.explore.model', 'categories.deep.fallback_models[0]'] },
    ]);
  });

  it('collects custom categories', () => {
    const config = { categories: { 'my-custom': { model: 'provider/z' } } };
    assert.deepEqual(collectModels(config), [
      { model: 'provider/z', paths: ['categories.my-custom.model'] },
    ]);
  });

  it('ignores entries with missing model fields', () => {
    assert.deepEqual(collectModels({ agents: { oracle: { variant: 'default' } } }), []);
  });

  it('ignores unknown fields', () => {
    const config = {
      agents: {
        oracle: { model: 'provider/a', temperature: 0.7, extra: { nested: true } },
      },
      unknownTopLevel: { model: 'provider/ignored' },
    };
    assert.deepEqual(collectModels(config), [
      { model: 'provider/a', paths: ['agents.oracle.model'] },
    ]);
  });

  it('returns [] for non-object input', () => {
    assert.deepEqual(collectModels(null), []);
    assert.deepEqual(collectModels(undefined), []);
    assert.deepEqual(collectModels('provider/a'), []);
    assert.deepEqual(collectModels(['provider/a']), []);
  });

  it('sorts results by model name', () => {
    const config = {
      categories: { deep: { model: 'zebra/model' } },
      agents: { oracle: { model: 'apple/model' } },
    };
    const models = collectModels(config).map((m) => m.model);
    assert.deepEqual(models, ['apple/model', 'zebra/model']);
  });
});
