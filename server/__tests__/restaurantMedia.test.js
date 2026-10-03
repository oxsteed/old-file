'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const mediaController = require('../controllers/restaurantMediaController');

const RESTAURANT_ROW = { id: 42, business_id: 7, owner_user_id: 'user-owner' };

function buildApp({ user = { id: 'user-123' }, extraUserFields = {} } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (user) {
      req.user = { ...user, ...extraUserFields };
      // Real auth middleware sets these top-level (middleware/auth.js).
      if (extraUserFields.isAdmin) req.isAdmin = true;
      if (extraUserFields.isSuperAdmin) req.isSuperAdmin = true;
    }
    next();
  });

  app.get('/api/restaurants/:restaurantId/media', mediaController.listRestaurantMedia);
  app.post(
    '/api/restaurants/:restaurantId/media',
    mediaController.mediaSubmitLimiter,
    mediaController.postRestaurantMedia
  );
  app.post('/api/restaurants/:restaurantId/media/:mediaId/like', mediaController.toggleMediaLike);
  app.delete('/api/restaurants/:restaurantId/media/:mediaId', mediaController.deleteRestaurantMedia);
  app.post(
    '/api/restaurants/:restaurantId/media/:mediaId/flags',
    mediaController.mediaFlagLimiter,
    mediaController.flagMedia
  );
  app.get('/api/admin/restaurant-media/flags', mediaController.adminListMediaFlags);
  app.post('/api/admin/restaurant-media/flags/:flagId/review', mediaController.adminReviewMediaFlag);

  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || err.status || 500).json({
      code: err.code,
      message: err.message,
    });
  });

  return app;
}

beforeEach(() => resetMocks());

// ── URL validation ───────────────────────────────────────────────────────────

describe('parseMediaVideoUrl', () => {
  const { parseMediaVideoUrl } = mediaController;

  test.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&list=PL123', 'youtube', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['https://www.vimeo.com/123456789', 'vimeo', '123456789'],
    ['https://vimeo.com/123456789', 'vimeo', '123456789'],
    ['https://vimeo.com/video/123456789', 'vimeo', '123456789'],
    ['https://player.vimeo.com/video/123456789', 'vimeo', '123456789'],
  ])('accepts %s', (url, provider, id) => {
    const parsed = parseMediaVideoUrl(url);
    expect(parsed).not.toBeNull();
    expect(parsed.provider).toBe(provider);
    expect(parsed.externalVideoId).toBe(id);
    expect(parsed.url.startsWith('https://')).toBe(true);
  });

  test('upgrades http to https', () => {
    const parsed = parseMediaVideoUrl('http://youtu.be/dQw4w9WgXcQ');
    expect(parsed.url).toBe('https://youtu.be/dQw4w9WgXcQ');
  });

  test.each([
    'https://www.tiktok.com/@chef/video/12345',
    'https://www.dailymotion.com/video/x7abcde',
    'https://evil.example.com/video.mp4',
    'https://www.youtube.com/channel/UC12345',
    'https://www.youtube.com/watch', // no v=
    'https://www.youtube.com/watch?v=short',
    'https://vimeo.com/channels/food',
    'javascript:alert(1)',
    'not a url',
    '',
    null,
    undefined,
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ'.replace('https', 'ftp'),
  ])('rejects %s', (url) => {
    expect(parseMediaVideoUrl(url)).toBeNull();
  });
});

// ── POST /media ──────────────────────────────────────────────────────────────

describe('postRestaurantMedia', () => {
  test('rejects non-YouTube/Vimeo URLs with media_invalid_url before touching the DB', async () => {
    const res = await request(buildApp())
      .post('/api/restaurants/42/media')
      .send({ video_url: 'https://www.tiktok.com/@chef/video/12345', caption: 'yum' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('media_invalid_url');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rejects captions over 280 chars', async () => {
    const res = await request(buildApp())
      .post('/api/restaurants/42/media')
      .send({ video_url: 'https://youtu.be/dQw4w9WgXcQ', caption: 'x'.repeat(281) });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('media_caption_too_long');
  });

  test('caps tagged dishes at 10', async () => {
    const res = await request(buildApp())
      .post('/api/restaurants/42/media')
      .send({ video_url: 'https://youtu.be/dQw4w9WgXcQ', dish_ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('media_too_many_dishes');
  });

  test('rejects dishes that do not belong to this restaurant', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [RESTAURANT_ROW] }) // getPublicRestaurant
      .mockResolvedValueOnce({ rows: [{ id: 10 }] }); // only one of the two dishes exists

    const res = await request(buildApp())
      .post('/api/restaurants/42/media')
      .send({ video_url: 'https://youtu.be/dQw4w9WgXcQ', dish_ids: [10, 99] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('media_dish_not_found');
  });

  test('accepts a valid post and snapshots dish name/price', async () => {
    const mediaRow = {
      id: 'media-1', video_url: 'https://youtu.be/dQw4w9WgXcQ', provider: 'youtube',
      external_video_id: 'dQw4w9WgXcQ', caption: 'Great noodles', created_at: new Date().toISOString(),
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [RESTAURANT_ROW] }) // getPublicRestaurant
      .mockResolvedValueOnce({
        rows: [{ id: 10, name: 'Ramen', price_cents: 1250, currency_code: 'USD' }],
      }) // dish lookup
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [mediaRow] }) // INSERT media
      .mockResolvedValueOnce({ rows: [] }) // INSERT media_items
      .mockResolvedValueOnce({}); // COMMIT

    const res = await request(buildApp())
      .post('/api/restaurants/42/media')
      .send({ video_url: 'https://youtu.be/dQw4w9WgXcQ', caption: 'Great noodles', dish_ids: [10] });

    expect(res.status).toBe(201);
    expect(res.body.media.provider).toBe('youtube');
    expect(res.body.media.external_video_id).toBe('dQw4w9WgXcQ');
    const insertCall = mockQuery.mock.calls.find(
      (c) => c[0].includes('INSERT INTO restaurant_media') && !c[0].includes('restaurant_media_items')
    );
    expect(insertCall).toBeDefined();
    const itemCall = mockQuery.mock.calls.find((c) => c[0].includes('INSERT INTO restaurant_media_items'));
    expect(itemCall[1]).toEqual(['media-1', 10, 'Ramen', 1250, 'USD']);
  });

  test('enforces 10 posts per day per user through the real limiter', async () => {
    // A dedicated user id keeps this bucket independent of the other tests,
    // since the limiter store is module-level.
    const app = buildApp({ user: { id: 'user-rate' } });
    const payload = { video_url: 'https://youtu.be/dQw4w9WgXcQ' };
    // Default mock: every DB call returns the restaurant row (enough for the
    // controller to proceed through BEGIN/COMMIT on mock data).
    mockQuery.mockImplementation(async () => ({ rows: [RESTAURANT_ROW] }));
    let lastStatus = null;
    for (let i = 0; i < 11; i++) {
      const res = await request(app).post('/api/restaurants/42/media').send(payload);
      lastStatus = res.status;
      if (i < 10) expect(res.status).toBe(201);
    }
    expect(lastStatus).toBe(429);
  });
});

// ── GET /media ───────────────────────────────────────────────────────────────

describe('listRestaurantMedia', () => {
  const MEDIA_ROW = {
    id: 'media-1', video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', provider: 'youtube',
    external_video_id: 'dQw4w9WgXcQ', caption: 'Great noodles', created_at: new Date().toISOString(),
    user_id: 'user-poster', first_name: 'Ada', last_name: 'Lovelace',
    like_count: 5, liked_by_me: false, verified_order: true,
  };

  function mockFeed({ mediaRows = [MEDIA_ROW], dishRows = [], viewerAuthed = true } = {}) {
    mockQuery
      .mockResolvedValueOnce({ rows: [RESTAURANT_ROW] }) // getPublicRestaurant
      .mockResolvedValueOnce({ rows: mediaRows }) // feed
      .mockResolvedValueOnce({ rows: [{ total: mediaRows.length }] }) // count
      .mockResolvedValueOnce({ rows: dishRows }); // dishes
  }

  test('404s on an invisible restaurant', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // getPublicRestaurant: none
    const res = await request(buildApp()).get('/api/restaurants/42/media');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('restaurant_not_found');
  });

  test('returns the feed shape with defaults (page 1, pageSize 10)', async () => {
    mockFeed();
    const res = await request(buildApp()).get('/api/restaurants/42/media');
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(10);
    expect(res.body.total).toBe(1);
    const [item] = res.body.items;
    expect(item.id).toBe('media-1');
    expect(item.poster).toEqual({ id: 'user-poster', name: 'Ada Lovelace' });
    expect(item.verified_order).toBe(true);
    expect(item.like_count).toBe(5);
    expect(item.dishes).toEqual([]);
  });

  test('verified_order is false when the poster has no completed order', async () => {
    mockFeed({ mediaRows: [{ ...MEDIA_ROW, verified_order: false }] });
    const res = await request(buildApp()).get('/api/restaurants/42/media');
    expect(res.body.items[0].verified_order).toBe(false);
  });

  test('liked_by_me is false when signed out', async () => {
    mockFeed({ mediaRows: [{ ...MEDIA_ROW, liked_by_me: false }] });
    const res = await request(buildApp({ user: null })).get('/api/restaurants/42/media');
    expect(res.status).toBe(200);
    expect(res.body.items[0].liked_by_me).toBe(false);
  });

  test('viewer_can_moderate is true for the restaurant owner', async () => {
    mockFeed();
    mockQuery.mockResolvedValueOnce({ rows: [{ '1': 1 }] }); // owner check: is owner
    const res = await request(buildApp()).get('/api/restaurants/42/media');
    expect(res.status).toBe(200);
    expect(res.body.viewer_can_moderate).toBe(true);
  });

  test('viewer_can_moderate is false for an ordinary viewer', async () => {
    mockFeed();
    mockQuery.mockResolvedValueOnce({ rows: [] }); // owner check: not owner
    const res = await request(buildApp()).get('/api/restaurants/42/media');
    expect(res.status).toBe(200);
    expect(res.body.viewer_can_moderate).toBe(false);
  });

  test('viewer_can_moderate is false when signed out', async () => {
    mockFeed();
    const res = await request(buildApp({ user: null })).get('/api/restaurants/42/media');
    expect(res.status).toBe(200);
    expect(res.body.viewer_can_moderate).toBe(false);
  });

  test('dish link-rot: unpublished dish falls back to the snapshot with available=false', async () => {
    const dishRows = [
      // Live and available → live name/price.
      {
        media_id: 'media-1', menu_item_id: 10, item_name_snapshot: 'Old Ramen',
        item_price_snapshot_cents: 999, currency_code: 'USD',
        live_name: 'Tonkotsu Ramen', live_price_cents: 1250, live_currency_code: 'USD',
        live_is_available: true,
      },
      // Row gone → snapshot, available=false.
      {
        media_id: 'media-1', menu_item_id: 11, item_name_snapshot: 'Gone Gyoza',
        item_price_snapshot_cents: 500, currency_code: 'USD',
        live_name: null, live_price_cents: null, live_currency_code: null,
        live_is_available: null,
      },
      // Exists but unavailable → snapshot, available=false.
      {
        media_id: 'media-1', menu_item_id: 12, item_name_snapshot: 'Paused Pho',
        item_price_snapshot_cents: 700, currency_code: 'USD',
        live_name: 'Paused Pho', live_price_cents: 800, live_currency_code: 'USD',
        live_is_available: false,
      },
    ];
    mockFeed({ dishRows });
    const res = await request(buildApp()).get('/api/restaurants/42/media');
    expect(res.status).toBe(200);
    const dishes = res.body.items[0].dishes;
    expect(dishes).toEqual([
      { menu_item_id: 10, name: 'Tonkotsu Ramen', price_cents: 1250, currency_code: 'USD', available: true },
      { menu_item_id: 11, name: 'Gone Gyoza', price_cents: 500, currency_code: 'USD', available: false },
      { menu_item_id: 12, name: 'Paused Pho', price_cents: 700, currency_code: 'USD', available: false },
    ]);
  });
});

// ── POST /media/:mediaId/like ────────────────────────────────────────────────

describe('toggleMediaLike', () => {
  test('likes when not yet liked', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'media-1' }] }) // media exists
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // no existing like
      .mockResolvedValueOnce({ rows: [] }) // INSERT
      .mockResolvedValueOnce({ rows: [{ like_count: 6 }] }) // count
      .mockResolvedValueOnce({}); // COMMIT

    const res = await request(buildApp())
      .post('/api/restaurants/42/media/media-1/like');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ liked: true, like_count: 6 });
    const insertCall = mockQuery.mock.calls.find((c) => c[0].includes('INSERT INTO restaurant_media_likes'));
    expect(insertCall[1]).toEqual(['media-1', 'user-123']);
  });

  test('unlikes when already liked (PK pair keeps one like per user)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'media-1' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{}] }) // existing like
      .mockResolvedValueOnce({ rows: [] }) // DELETE
      .mockResolvedValueOnce({ rows: [{ like_count: 5 }] })
      .mockResolvedValueOnce({});

    const res = await request(buildApp())
      .post('/api/restaurants/42/media/media-1/like');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ liked: false, like_count: 5 });
  });

  test('404s on missing or hidden media', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp())
      .post('/api/restaurants/42/media/nope/like');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('media_not_found');
  });
});

// ── DELETE /media/:mediaId ───────────────────────────────────────────────────

describe('deleteRestaurantMedia', () => {
  const MEDIA_ROW = { id: 'media-1', user_id: 'user-poster' };

  test('poster can delete their own media', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [MEDIA_ROW] })
      .mockResolvedValueOnce({ rows: [] }); // soft-delete
    const res = await request(buildApp({ user: { id: 'user-poster' } }))
      .delete('/api/restaurants/42/media/media-1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const updateCall = mockQuery.mock.calls.find((c) => c[0].includes("status = 'hidden'"));
    expect(updateCall).toBeDefined();
  });

  test('stranger gets 403 without hitting the admin grant path', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [MEDIA_ROW] }) // media
      .mockResolvedValueOnce({ rows: [] }); // not owner
    const res = await request(buildApp())
      .delete('/api/restaurants/42/media/media-1');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('media_forbidden');
    const grantCall = mockQuery.mock.calls.find((c) => c[0].includes('admin_permission_grants'));
    expect(grantCall).toBeUndefined();
  });

  test('restaurant owner can delete', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [MEDIA_ROW] })
      .mockResolvedValueOnce({ rows: [{}] }) // owner match
      .mockResolvedValueOnce({ rows: [] }); // soft-delete
    const res = await request(buildApp({ user: { id: 'user-owner' } }))
      .delete('/api/restaurants/42/media/media-1');
    expect(res.status).toBe(200);
  });

  test('super-admin bypasses the grant check', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [MEDIA_ROW] })
      .mockResolvedValueOnce({ rows: [] }) // not owner
      .mockResolvedValueOnce({ rows: [] }); // soft-delete
    const res = await request(buildApp({
      user: { id: 'user-admin' },
      extraUserFields: { isAdmin: true, isSuperAdmin: true },
    })).delete('/api/restaurants/42/media/media-1');
    expect(res.status).toBe(200);
    const grantCall = mockQuery.mock.calls.find((c) => c[0].includes('admin_permission_grants'));
    expect(grantCall).toBeUndefined();
  });

  test('admin with the moderate_content grant can delete', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [MEDIA_ROW] })
      .mockResolvedValueOnce({ rows: [] }) // not owner
      .mockResolvedValueOnce({ rows: [{}] }) // grant found
      .mockResolvedValueOnce({ rows: [] }); // soft-delete
    const res = await request(buildApp({
      user: { id: 'user-admin' },
      extraUserFields: { isAdmin: true, isSuperAdmin: false },
    })).delete('/api/restaurants/42/media/media-1');
    expect(res.status).toBe(200);
  });

  test('404s when the media row does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp())
      .delete('/api/restaurants/42/media/nope');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('media_not_found');
  });
});

// ── POST /media/:mediaId/flags ────────────────────────────────────────────────

describe('flagMedia', () => {
  test('rejects invalid reasons', async () => {
    const res = await request(buildApp())
      .post('/api/restaurants/42/media/media-1/flags')
      .send({ reason: 'meh' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_flag_reason');
  });

  test('records a flag', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'media-1' }] }) // media visible
      .mockResolvedValueOnce({ rows: [{ id: 'flag-1' }] }); // insert
    const res = await request(buildApp())
      .post('/api/restaurants/42/media/media-1/flags')
      .send({ reason: 'spam', note: 'not a dish video' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const insertCall = mockQuery.mock.calls.find((c) => c[0].includes('INSERT INTO restaurant_media_flags'));
    expect(insertCall[1]).toEqual(['media-1', 'user-123', 'spam', 'not a dish video']);
  });

  test('409s when an open flag already exists for this user (partial unique index)', async () => {
    const conflict = new Error('duplicate key value');
    conflict.code = '23505';
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'media-1' }] })
      .mockRejectedValueOnce(conflict);
    const res = await request(buildApp())
      .post('/api/restaurants/42/media/media-1/flags')
      .send({ reason: 'spam' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('media_flag_exists');
  });
});

// ── Admin flag review ────────────────────────────────────────────────────────

describe('adminReviewMediaFlag', () => {
  const FLAG_ROW = { id: 'flag-1', media_id: 'media-1', status: 'open' };

  test('dismiss closes just the flag', async () => {
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [FLAG_ROW] }) // FOR UPDATE
      .mockResolvedValueOnce({ rows: [] }) // UPDATE flag → dismissed
      .mockResolvedValueOnce({}); // COMMIT
    const res = await request(buildApp({
      user: { id: 'user-admin' },
      extraUserFields: { isAdmin: true },
    }))
      .post('/api/admin/restaurant-media/flags/flag-1/review')
      .send({ action: 'dismiss' });
    expect(res.status).toBe(200);
    const dismissCall = mockQuery.mock.calls.find((c) => c[0].includes("status = 'dismissed'"));
    expect(dismissCall).toBeDefined();
    const hideCall = mockQuery.mock.calls.find((c) => c[0].includes('UPDATE restaurant_media SET'));
    expect(hideCall).toBeUndefined();
  });

  test('remove hides the media and resolves its open flags', async () => {
    mockQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [FLAG_ROW] })
      .mockResolvedValueOnce({ rows: [] }) // hide media
      .mockResolvedValueOnce({ rows: [] }) // resolve open flags
      .mockResolvedValueOnce({});
    const res = await request(buildApp({
      user: { id: 'user-admin' },
      extraUserFields: { isAdmin: true },
    }))
      .post('/api/admin/restaurant-media/flags/flag-1/review')
      .send({ action: 'remove' });
    expect(res.status).toBe(200);
    const hideCall = mockQuery.mock.calls.find((c) => c[0].includes('UPDATE restaurant_media SET'));
    expect(hideCall[1]).toEqual(['media-1']);
    const resolveCall = mockQuery.mock.calls.find((c) => c[0].includes("status = 'resolved'"));
    expect(resolveCall).toBeDefined();
  });

  test('409s when the flag was already decided', async () => {
    mockQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ ...FLAG_ROW, status: 'dismissed' }] })
      .mockResolvedValueOnce({}); // ROLLBACK
    const res = await request(buildApp({
      user: { id: 'user-admin' },
      extraUserFields: { isAdmin: true },
    }))
      .post('/api/admin/restaurant-media/flags/flag-1/review')
      .send({ action: 'dismiss' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('media_flag_already_decided');
  });

  test('rejects unknown actions', async () => {
    const res = await request(buildApp({
      user: { id: 'user-admin' },
      extraUserFields: { isAdmin: true },
    }))
      .post('/api/admin/restaurant-media/flags/flag-1/review')
      .send({ action: 'ban' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('media_flag_invalid_action');
  });

  test('admin list returns flags with restaurant context', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'flag-1', media_id: 'media-1', reason: 'spam', note: null, status: 'open',
        created_at: new Date().toISOString(), video_url: 'https://youtu.be/x', provider: 'youtube',
        caption: 'yum', restaurant_id: 42, restaurant_name: 'Noodle House',
        open_flags: 2, flagged_by_email: 'a@x.com', decided_by_email: null,
      }],
    });
    const res = await request(buildApp({
      user: { id: 'user-admin' },
      extraUserFields: { isAdmin: true },
    })).get('/api/admin/restaurant-media/flags?status=open');
    expect(res.status).toBe(200);
    expect(res.body.flags).toHaveLength(1);
    expect(res.body.flags[0].restaurant_name).toBe('Noodle House');
  });

  test('admin list rejects bad status filters', async () => {
    const res = await request(buildApp({
      user: { id: 'user-admin' },
      extraUserFields: { isAdmin: true },
    })).get('/api/admin/restaurant-media/flags?status=bogus');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('bad_status');
  });
});
