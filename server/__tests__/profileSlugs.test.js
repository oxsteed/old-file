/**
 * __tests__/profileSlugs.test.js
 *
 * Vanity profile slugs (/h/:slug, /b/:slug):
 *  - validation rules, reserved words, normalization, suggestions
 *  - availability endpoint behavior
 *  - claim endpoints: success, taken (409 + suggestions), race (23505),
 *    30-day cooldown (429), idempotent re-claim
 */

'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

const {
  normalizeSlug,
  validateSlug,
  suggestSlugs,
  RESERVED,
  SLUG_CHANGE_COOLDOWN_MS,
} = require('../utils/profileSlug');

const slugRoutes = require('../routes/profileSlugs');
const profileSlugController = require('../controllers/profileSlugController');

// ── availability app (public, no auth) ────────────────────────────────────────
const availabilityApp = express();
availabilityApp.use(express.json());
availabilityApp.use('/api/profile-slugs', slugRoutes);

// ── claim apps (auth + authorization mocked) ──────────────────────────────────
jest.mock('../middleware/rateLimiter', () => ({ generalLimiter: (_req, _res, next) => next() }));
jest.mock('../utils/logger', () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));

function claimApp(routeSetup) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: req.get('x-test-user') || 'helper-user-1', role: 'helper' };
    next();
  });
  routeSetup(app);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  return app;
}

const helperClaimApp = claimApp((app) =>
  app.put('/api/helper-profile/slug', profileSlugController.setHelperSlug)
);
const businessClaimApp = claimApp((app) =>
  app.put('/api/businesses/:id/slug', (req, res, next) => {
    // simulate bizIdAccess('owner'): only user 'biz-owner-1' may claim for business 7
    if (req.user.id !== 'biz-owner-1' || req.params.id !== '7') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return profileSlugController.setBusinessSlug(req, res, next);
  })
);

beforeEach(() => resetMocks());

// ══════════════════════════════════════════════════════════════════════════════
// Validation / normalization
// ══════════════════════════════════════════════════════════════════════════════

describe('validateSlug', () => {
  test('accepts a well-formed slug', () => {
    expect(validateSlug('mike-plumber-24')).toEqual({ ok: true, slug: 'mike-plumber-24' });
  });

  test('lowercases input', () => {
    expect(validateSlug('Mike-Plumber').slug).toBe('mike-plumber');
  });

  test('accepts exactly 64 chars (matches DB check constraint), rejects 65', () => {
    expect(validateSlug('a'.repeat(64)).ok).toBe(true);
    const r = validateSlug('a'.repeat(65));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('too_long');
  });

  test.each([
    ['ab', 'too_short'],
    ['', 'empty'],
    ['   ', 'empty'],
    ['-leading', 'invalid_chars'],
    ['trailing-', 'invalid_chars'],
    ['has space', 'invalid_chars'],
    ['under_score', 'invalid_chars'],
    ['UPPER-OK'.repeat(20), 'too_long'],
  ])('rejects %p with reason %p', (input, reason) => {
    const r = validateSlug(input);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(reason);
  });

  test('rejects reserved words', () => {
    for (const word of ['admin', 'helpers', 'businesses', 'api', 'login', 'official', 'verified']) {
      expect(RESERVED.has(word)).toBe(true);
      const r = validateSlug(word);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('reserved');
    }
  });

  test('short reserved tokens are rejected on length first', () => {
    expect(validateSlug('h').reason).toBe('too_short');
  });
});

describe('normalizeSlug', () => {
  test('trims, lowercases, and converts separators to hyphens', () => {
    expect(normalizeSlug('  Mike the Plumber!  ')).toBe('mike-the-plumber');
  });

  test('truncates to 64 chars', () => {
    expect(normalizeSlug('a'.repeat(100)).length).toBe(64);
  });
});

describe('suggestSlugs', () => {
  test('returns numbered alternatives skipping taken ones', async () => {
    const taken = new Set(['mike-plumber', 'mike-plumber-2']);
    const out = await suggestSlugs('mike-plumber', {
      count: 3,
      isTaken: async (c) => taken.has(c),
    });
    expect(out).toEqual(['mike-plumber-3', 'mike-plumber-4', 'mike-plumber-5']);
  });

  test('skips reserved candidates', async () => {
    const out = await suggestSlugs('new', { count: 3, isTaken: async () => false });
    expect(out.every((s) => !RESERVED.has(s))).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Availability endpoint
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/profile-slugs/check', () => {
  test('reports invalid slugs without touching the taken-check', async () => {
    const res = await request(availabilityApp)
      .get('/api/profile-slugs/check')
      .query({ slug: 'ab', type: 'helper' })
      .expect(200);
    expect(res.body).toMatchObject({ slug: 'ab', type: 'helper', available: false, reason: 'too_short', suggestions: [] });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('reports reserved slugs', async () => {
    const res = await request(availabilityApp)
      .get('/api/profile-slugs/check')
      .query({ slug: 'admin', type: 'business' })
      .expect(200);
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toBe('reserved');
  });

  test('reports a free slug as available', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(availabilityApp)
      .get('/api/profile-slugs/check')
      .query({ slug: 'fresh-slug-9', type: 'helper' })
      .expect(200);
    expect(res.body).toMatchObject({ slug: 'fresh-slug-9', available: true, suggestions: [] });
  });

  test('reports a taken slug with three suggestions', async () => {
    // First call: base slug taken. Suggestion candidates: -2 taken, -3 free, -4 free, -5 free.
    mockQuery.mockImplementation(async (_sql, params) => {
      const slug = params[0];
      return { rows: slug === 'taken-slug' || slug === 'taken-slug-2' ? [{}] : [] };
    });
    const res = await request(availabilityApp)
      .get('/api/profile-slugs/check')
      .query({ slug: 'taken-slug', type: 'helper' })
      .expect(200);
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toBe('taken');
    expect(res.body.suggestions).toEqual(['taken-slug-3', 'taken-slug-4', 'taken-slug-5']);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Helper claim endpoint
// ══════════════════════════════════════════════════════════════════════════════

describe('PUT /api/helper-profile/slug', () => {
  function mockClaimFlow({ currentSlug = null, updatedAt = null, taken = false, insertError = null }) {
    mockQuery.mockImplementation(async (sql, params) => {
      if (/SELECT profile_slug, profile_slug_updated_at FROM helper_profiles/.test(sql)) {
        return { rows: currentSlug || updatedAt ? [{ profile_slug: currentSlug, profile_slug_updated_at: updatedAt }] : [] };
      }
      if (/SELECT 1 FROM helper_profiles WHERE profile_slug/.test(sql)) {
        return { rows: taken ? [{}] : [] };
      }
      if (/INSERT INTO helper_profiles/.test(sql)) {
        if (insertError) throw insertError;
        return { rows: [] };
      }
      return { rows: [] };
    });
  }

  test('claims a free slug and returns the canonical /h/ URL', async () => {
    mockClaimFlow({});
    const res = await request(helperClaimApp)
      .put('/api/helper-profile/slug')
      .send({ slug: 'mike-plumber' })
      .expect(200);
    expect(res.body).toMatchObject({ ok: true, slug: 'mike-plumber', profileUrl: '/h/mike-plumber' });
    const insertCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO helper_profiles/.test(sql));
    expect(insertCall[1]).toEqual(['helper-user-1', 'mike-plumber']);
  });

  test('rejects an invalid slug with 400', async () => {
    const res = await request(helperClaimApp)
      .put('/api/helper-profile/slug')
      .send({ slug: 'ab' })
      .expect(400);
    expect(res.body.code).toBe('slug_too_short');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('returns 409 with suggestions when taken by someone else', async () => {
    mockQuery.mockImplementation(async (sql, params) => {
      if (/SELECT 1 FROM helper_profiles WHERE profile_slug/.test(sql)) {
        const slug = params[0];
        // excludeUserId variant appends user_id <> $2; base taken, -2 taken, rest free
        return { rows: slug === 'mike-plumber' || slug === 'mike-plumber-2' ? [{}] : [] };
      }
      return { rows: [] };
    });
    const res = await request(helperClaimApp)
      .put('/api/helper-profile/slug')
      .send({ slug: 'mike-plumber' })
      .expect(409);
    expect(res.body.code).toBe('slug_taken');
    expect(res.body.suggestions).toEqual(['mike-plumber-3', 'mike-plumber-4', 'mike-plumber-5']);
  });

  test('re-claiming the same slug is idempotent and skips cooldown', async () => {
    const updatedAt = new Date(Date.now() - 1000).toISOString(); // within cooldown
    mockClaimFlow({ currentSlug: 'mike-plumber', updatedAt });
    const res = await request(helperClaimApp)
      .put('/api/helper-profile/slug')
      .send({ slug: 'MIKE-PLUMBER' })
      .expect(200);
    expect(res.body.unchanged).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO helper_profiles/.test(sql))).toBe(false);
  });

  test('changing within 30 days returns 429 with changeAvailableAt', async () => {
    const updatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 1 day ago
    mockClaimFlow({ currentSlug: 'old-slug', updatedAt });
    const res = await request(helperClaimApp)
      .put('/api/helper-profile/slug')
      .send({ slug: 'new-slug' })
      .expect(429);
    expect(res.body.code).toBe('slug_cooldown');
    const availableAt = new Date(res.body.changeAvailableAt).getTime();
    const expected = new Date(updatedAt).getTime() + SLUG_CHANGE_COOLDOWN_MS;
    expect(Math.abs(availableAt - expected)).toBeLessThan(2000);
  });

  test('a claim race (23505) becomes a 409 slug_taken', async () => {
    const race = new Error('duplicate key');
    race.code = '23505';
    mockClaimFlow({ insertError: race });
    // availability passes because the pre-check runs before the insert
    mockQuery.mockImplementation(async (sql, params) => {
      if (/SELECT profile_slug, profile_slug_updated_at FROM helper_profiles/.test(sql)) return { rows: [] };
      if (/SELECT 1 FROM helper_profiles WHERE profile_slug/.test(sql)) return { rows: [] };
      if (/INSERT INTO helper_profiles/.test(sql)) throw race;
      return { rows: [] };
    });
    const res = await request(helperClaimApp)
      .put('/api/helper-profile/slug')
      .send({ slug: 'race-slug' })
      .expect(409);
    expect(res.body.code).toBe('slug_taken');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Business claim endpoint
// ══════════════════════════════════════════════════════════════════════════════

describe('PUT /api/businesses/:id/slug', () => {
  test('owner claims a free slug and gets the canonical /b/ URL', async () => {
    mockQuery.mockImplementation(async (sql, params) => {
      if (/SELECT profile_slug, profile_slug_updated_at FROM businesses/.test(sql)) return { rows: [] };
      if (/SELECT 1 FROM businesses WHERE profile_slug/.test(sql)) return { rows: [] };
      if (/UPDATE businesses/.test(sql)) {
        expect(params).toEqual([7, 'acme-co']);
        return { rowCount: 1, rows: [] };
      }
      return { rows: [] };
    });
    const res = await request(businessClaimApp)
      .put('/api/businesses/7/slug')
      .set('x-test-user', 'biz-owner-1')
      .send({ slug: 'acme-co' })
      .expect(200);
    expect(res.body).toMatchObject({ ok: true, slug: 'acme-co', profileUrl: '/b/acme-co' });
  });

  test('non-owner is rejected by business access control', async () => {
    await request(businessClaimApp)
      .put('/api/businesses/7/slug')
      .send({ slug: 'acme-co' })
      .expect(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rejects a non-numeric business id', async () => {
    const app = claimApp((a) =>
      a.put('/api/businesses/:id/slug', (req, res, next) => {
        req.user = { id: 'biz-owner-1' };
        return profileSlugController.setBusinessSlug(req, res, next);
      })
    );
    await request(app).put('/api/businesses/abc/slug').send({ slug: 'acme-co' }).expect(400);
  });
});
