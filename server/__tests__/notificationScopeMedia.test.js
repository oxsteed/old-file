'use strict';

// Contract lock for the media undercount fix (Domain 9 audit #12
// follow-up): GET /notifications?scope=media must filter server-side to
// the media types with its own limit, so the media tab's list is not
// bounded by the latest-100 unscoped window. The client repro for the
// undercount itself lives in
// client/scripts/mediaNotificationsScopedFetch.test.mjs; this test pins
// the server half of that contract (the type filter in the list and
// count queries).
//
// Run with:
//   npx jest __tests__/notificationScopeMedia.test.js --forceExit
//

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const notificationController = require('../controllers/notificationController');

const MEDIA_TYPES = [
  'media_reply', 'media_like', 'media_repost', 'media_quote',
  'media_follow', 'media_creator_update',
];

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user-123' };
    next();
  });
  app.get('/api/notifications', notificationController.getNotifications);
  return app;
}

beforeEach(() => resetMocks());

describe('GET /notifications scope=media', () => {
  test('filters server-side to the media types with its own limit', async () => {
    const mediaRows = [
      { id: 201, type: 'media_reply', title: 'Reply', is_read: false, created_at: '2026-11-01T00:00:00.000Z', read_at: null },
      { id: 202, type: 'media_like', title: 'Like', is_read: true, created_at: '2026-11-01T00:00:00.000Z', read_at: '2026-11-02T00:00:00.000Z' },
    ];
    mockQuery.mockImplementation(async (sql) => {
      if (String(sql).includes('COUNT(*)')) return { rows: [{ count: '1' }] };
      return { rows: mediaRows };
    });

    const res = await request(buildApp()).get('/api/notifications?scope=media&limit=100');
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('media');
    expect(res.body.limit).toBe(100);
    expect(res.body.notifications).toEqual(mediaRows);
    expect(res.body.unread_count).toBe(1);

    // The list query scopes by type server-side (not a client filter).
    const listCall = mockQuery.mock.calls.find(([sql]) => !String(sql).includes('COUNT(*)'));
    expect(listCall[0]).toMatch('type = ANY');
    expect(listCall[1]).toContainEqual(expect.arrayContaining(MEDIA_TYPES));
    // The unread count is scoped too.
    const countCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('COUNT(*)'));
    expect(countCall[0]).toMatch('type = ANY');
  });

  test('without scope the list query has no media type filter', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (String(sql).includes('COUNT(*)')) return { rows: [{ count: '0' }] };
      return { rows: [] };
    });

    const res = await request(buildApp()).get('/api/notifications?limit=100');
    expect(res.status).toBe(200);
    expect(res.body.scope).toBeNull();
    const listCall = mockQuery.mock.calls.find(([sql]) => !String(sql).includes('COUNT(*)'));
    expect(listCall[0]).not.toMatch('type = ANY');
  });
});
