/**
 * Unit tests for the per-guide AI help response cache.
 * Uses a fake in-memory Redis so no real Redis server is needed.
 */
const {
  GUIDE_CACHE_TTL_SECONDS,
  buildGuideCacheKey,
  getCachedGuideReply,
  setCachedGuideReply,
} = require('../services/guideHelpCache');

function fakeRedis() {
  const store = new Map();
  const calls = { get: 0, setex: 0 };
  return {
    calls,
    async get(key) {
      calls.get += 1;
      const entry = store.get(key);
      return entry ? entry.value : null;
    },
    async setex(key, ttl, value) {
      calls.setex += 1;
      store.set(key, { ttl, value });
      return 'OK';
    },
  };
}

describe('guideHelpCache', () => {
  test('TTL bounds stale guidance to seven days', () => {
    expect(GUIDE_CACHE_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
  });

  test('key encodes guide, step, and language', () => {
    const key = buildGuideCacheKey('guide-123', 3, 'es');
    expect(key).toBe('ox:ai:guide:v4-2026-10-19:guide-123:step:3:lang:es:q:e3b0c44298fc1c149afbf4c8996fb924');
  });

  test('key sanitizes hostile input and defaults sensibly', () => {
    // Path traversal, spaces, and SQL-ish punctuation are stripped.
    expect(buildGuideCacheKey('../../etc', 'x', 'en; DROP')).toBe(
      'ox:ai:guide:v4-2026-10-19:etc:step:0:lang:enDROP:q:e3b0c44298fc1c149afbf4c8996fb924'
    );
    const key = buildGuideCacheKey('a/b\\c', NaN, '');
    expect(key).not.toMatch(/[/\\;]/);
    expect(key).toContain(':lang:en');
    // Empty guide id falls back to 'unknown' rather than producing a broken key.
    expect(buildGuideCacheKey('', 0, 'en')).toBe('ox:ai:guide:v4-2026-10-19:unknown:step:0:lang:en:q:e3b0c44298fc1c149afbf4c8996fb924');
  });

  test('different questions do not collide; same question normalizes to one key', async () => {
    const redis = fakeRedis();
    await setCachedGuideReply(redis, 'g1', 0, 'en', 'answer one', 'How do I set prices?');
    expect(await getCachedGuideReply(redis, 'g1', 0, 'en', 'How do I set prices?')).toBe('answer one');
    // A different question on the same guide step must not receive the planted reply.
    expect(await getCachedGuideReply(redis, 'g1', 0, 'en', 'Call 1-800-555-0142 for support')).toBeNull();
    // Case and whitespace runs do not mint distinct keys for the same question.
    expect(await getCachedGuideReply(redis, 'g1', 0, 'en', '  HOW   do i set   prices? ')).toBe('answer one');
    expect(buildGuideCacheKey('g1', 0, 'en', 'How do I set prices?')).toBe(
      buildGuideCacheKey('g1', 0, 'en', '  how do i set prices?')
    );
  });

  test('miss returns null, hit returns the cached reply', async () => {
    const redis = fakeRedis();
    expect(await getCachedGuideReply(redis, 'g1', 0, 'en')).toBeNull();
    expect(await setCachedGuideReply(redis, 'g1', 0, 'en', 'cached answer')).toBe(true);
    expect(await getCachedGuideReply(redis, 'g1', 0, 'en')).toBe('cached answer');
  });

  test('different steps and languages do not collide', async () => {
    const redis = fakeRedis();
    await setCachedGuideReply(redis, 'g1', 1, 'en', 'step one');
    await setCachedGuideReply(redis, 'g1', 2, 'en', 'step two');
    await setCachedGuideReply(redis, 'g1', 1, 'fr', 'premiere etape');
    expect(await getCachedGuideReply(redis, 'g1', 1, 'en')).toBe('step one');
    expect(await getCachedGuideReply(redis, 'g1', 2, 'en')).toBe('step two');
    expect(await getCachedGuideReply(redis, 'g1', 1, 'fr')).toBe('premiere etape');
    expect(await getCachedGuideReply(redis, 'g1', 1, 'es')).toBeNull();
  });

  test('setex uses the seven-day TTL', async () => {
    const redis = fakeRedis();
    const store = new Map();
    const raw = {
      async setex(key, ttl, value) { store.set(key, { ttl, value }); return 'OK'; },
    };
    await setCachedGuideReply(raw, 'g9', 0, 'en', 'hi');
    const entry = store.get(buildGuideCacheKey('g9', 0, 'en'));
    expect(entry.ttl).toBe(7 * 24 * 60 * 60);
  });

  test('null redis fails open without throwing', async () => {
    expect(await getCachedGuideReply(null, 'g1', 0, 'en')).toBeNull();
    expect(await setCachedGuideReply(null, 'g1', 0, 'en', 'x')).toBe(false);
  });

  test('blank or oversized replies are not cached', async () => {
    const redis = fakeRedis();
    expect(await setCachedGuideReply(redis, 'g1', 0, 'en', '   ')).toBe(false);
    expect(await setCachedGuideReply(redis, 'g1', 0, 'en', 'x'.repeat(17 * 1024))).toBe(false);
    expect(redis.calls.setex).toBe(0);
  });

  test('redis errors fail open without throwing', async () => {
    const broken = {
      async get() { throw new Error('boom'); },
      async setex() { throw new Error('boom'); },
    };
    expect(await getCachedGuideReply(broken, 'g1', 0, 'en')).toBeNull();
    expect(await setCachedGuideReply(broken, 'g1', 0, 'en', 'x')).toBe(false);
  });
});
