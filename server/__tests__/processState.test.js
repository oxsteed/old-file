'use strict';

/**
 * Unit tests for utils/processState.js — the V2-P1-06 uniform contract.
 */

const processState = require('../utils/processState');
const { createTtlCache, tryAcquireOnce, throttleOnce, registerProcessState } = processState;

beforeEach(() => {
  processState._resetForTests();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('createTtlCache', () => {
  test('returns values before TTL, undefined after', () => {
    const cache = createTtlCache({ name: 't', ttlMs: 1000 });
    cache.set('k', 'v');
    expect(cache.get('k')).toBe('v');
    expect(cache.has('k')).toBe(true);
    jest.advanceTimersByTime(1001);
    expect(cache.get('k')).toBeUndefined();
    expect(cache.has('k')).toBe(false);
  });

  test('per-entry TTL override wins over the default', () => {
    const cache = createTtlCache({ name: 't', ttlMs: 60 * 1000 });
    cache.set('short', 'v', 500);
    cache.set('long', 'v');
    jest.advanceTimersByTime(501);
    expect(cache.get('short')).toBeUndefined();
    expect(cache.get('long')).toBe('v');
  });

  test('evicts oldest entries when maxEntries is reached', () => {
    const cache = createTtlCache({ name: 't', ttlMs: 60 * 1000, maxEntries: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  test('rewriting an existing key does not evict', () => {
    const cache = createTtlCache({ name: 't', ttlMs: 60 * 1000, maxEntries: 1 });
    cache.set('a', 1);
    cache.set('a', 2);
    expect(cache.get('a')).toBe(2);
    expect(cache.size).toBe(1);
  });

  test('delete and clear work', () => {
    const cache = createTtlCache({ name: 't', ttlMs: 60 * 1000 });
    cache.set('a', 1);
    expect(cache.delete('a')).toBe(true);
    expect(cache.get('a')).toBeUndefined();
    cache.set('b', 2);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  test('rejects invalid options', () => {
    expect(() => createTtlCache({ ttlMs: 1000 })).toThrow();
    expect(() => createTtlCache({ name: 't', ttlMs: 0 })).toThrow();
    expect(() => createTtlCache({ name: 't', ttlMs: 1000, maxEntries: 0 })).toThrow();
  });
});

describe('registerProcessState', () => {
  test('rejects unknown classifications and duplicates', () => {
    expect(() => registerProcessState({
      file: 'x.js', name: 'y', classification: 'nope', shared: 'none', rationale: 'r',
    })).toThrow();
    expect(() => registerProcessState({
      file: 'x.js', name: 'y', classification: 'cache', shared: 'mars', rationale: 'r',
    })).toThrow();
    expect(() => registerProcessState({
      file: 'x.js', name: 'y', classification: 'cache', shared: 'none', rationale: '  ',
    })).toThrow();
    registerProcessState({ file: 'x.js', name: 'y', classification: 'cache', shared: 'none', rationale: 'r' });
    expect(() => registerProcessState({ file: 'x.js', name: 'y', classification: 'cache', shared: 'none', rationale: 'r' }))
      .toThrow(/duplicate/);
  });
});

function fakeRedisStore() {
  const store = new Map(); // key -> expiresAtMs
  return {
    async set(key, _v, _ex, _ttl, nx) {
      const now = Date.now();
      const exp = store.get(key);
      if (exp !== undefined && exp > now) {
        return nx === 'NX' ? null : 'OK';
      }
      store.set(key, now + 1000);
      return 'OK';
    },
  };
}

describe('tryAcquireOnce', () => {
  test('with Redis: first caller wins, second loses (SET NX)', async () => {
    const redis = fakeRedisStore();
    await expect(tryAcquireOnce('k', 60, { namespace: 't', redis })).resolves.toBe(true);
    await expect(tryAcquireOnce('k', 60, { namespace: 't', redis })).resolves.toBe(false);
  });

  test('without Redis: bounded in-memory fence with TTL semantics', async () => {
    processState._injectRedis(null);
    await expect(tryAcquireOnce('k', 60, { namespace: 't' })).resolves.toBe(true);
    await expect(tryAcquireOnce('k', 60, { namespace: 't' })).resolves.toBe(false);
    jest.advanceTimersByTime(61 * 1000);
    await expect(tryAcquireOnce('k', 60, { namespace: 't' })).resolves.toBe(true);
  });

  test('namespaces isolate keys', async () => {
    const redis = fakeRedisStore();
    await expect(tryAcquireOnce('k', 60, { namespace: 'a', redis })).resolves.toBe(true);
    await expect(tryAcquireOnce('k', 60, { namespace: 'b', redis })).resolves.toBe(true);
  });

  test('Redis error degrades to the memory fence by default, fails closed on request', async () => {
    const broken = { set: async () => { throw new Error('boom'); } };
    await expect(tryAcquireOnce('k1', 60, { namespace: 't', redis: broken })).resolves.toBe(true);
    await expect(tryAcquireOnce('k1', 60, { namespace: 't', redis: broken })).resolves.toBe(false);
    await expect(tryAcquireOnce('k2', 60, { namespace: 't', redis: broken, failClosed: true })).resolves.toBe(false);
  });

  test('throttleOnce allows the first call per window only', async () => {
    const redis = fakeRedisStore();
    await expect(throttleOnce('w', 60, { redis })).resolves.toBe(true);
    await expect(throttleOnce('w', 60, { redis })).resolves.toBe(false);
  });

  test('rejects invalid key/ttl', async () => {
    await expect(tryAcquireOnce('', 60)).rejects.toThrow();
    await expect(tryAcquireOnce('k', 0)).rejects.toThrow();
  });
});

describe('releaseFence', () => {
  test('releases a won fence so it can be re-acquired (Redis)', async () => {
    const store = new Map();
    const redis = {
      set: async (key, _v, _ex, _ttl, nx) => {
        if (nx === 'NX' && store.has(key)) return null;
        store.set(key, true);
        return 'OK';
      },
      del: async (key) => (store.delete(key) ? 1 : 0),
    };
    const { releaseFence } = processState;
    expect(await tryAcquireOnce('k', 60, { namespace: 't', redis })).toBe(true);
    expect(await tryAcquireOnce('k', 60, { namespace: 't', redis })).toBe(false);
    await releaseFence('k', { namespace: 't', redis });
    expect(await tryAcquireOnce('k', 60, { namespace: 't', redis })).toBe(true);
  });

  test('releases the in-memory fallback fence', async () => {
    const { releaseFence } = processState;
    expect(await tryAcquireOnce('k', 60, { namespace: 't' })).toBe(true);
    await releaseFence('k', { namespace: 't' });
    expect(await tryAcquireOnce('k', 60, { namespace: 't' })).toBe(true);
  });
});
