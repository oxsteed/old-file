'use strict';

/**
 * ADM-028: media flag removal (incl. DMCA) was one-click with no confirmation
 * and no restore path — restorePost refused dmca_removed outright.
 * - restorePost now accepts dmca_removed when a counter-notice reference
 *   (>= 10 chars) is supplied, and lifts the dmca_revoked asset/cleanup
 *   markers too.
 * - restorePost still 400s on a DMCA restore without a counter-notice ref,
 *   and still 409s on safety_blocked / csam-flagged posts.
 */

const { mockQuery, resetMocks } = require('./setup');
const express = require('express');
const request = require('supertest');

jest.mock('../middleware/adminAuth', () => ({
  requireAdmin: (req, _res, next) => { req.user = { id: 'admin-1' }; next(); },
  requirePermission: () => (_req, _res, next) => next(),
}));
jest.mock('../services/auditService', () => ({
  logAdminAction: jest.fn().mockResolvedValue({}),
}));
jest.mock('../services/mediaSafetyPolicy', () => ({
  postVerdictAllowed: jest.fn(() => true),
  assetReady: jest.fn(() => true),
}));

const mediaAdminCtrl = require('../controllers/mediaAdminController');
const auditService = require('../services/auditService');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'admin-1' }; next(); });
  app.post('/api/admin/media/posts/:id/restore', mediaAdminCtrl.restorePost);
  return app;
}
const app = buildApp();

function mockPostRow(overrides = {}) {
  return {
    id: 'post-1',
    visibility: 'removed',
    moderation_state: 'admin_removed',
    csam_status: 'passed',
    processing_status: 'ready',
    current_actor_verified: true,
    actor_type: 'creator',
    ...overrides,
  };
}

function mockRestoreDb(postOverrides = {}) {
  mockQuery.mockImplementation(async (text) => {
    const t = String(text || '');
    if (t.includes('FROM media_posts p JOIN media_actors a')) {
      return { rows: [mockPostRow(postOverrides)], rowCount: 1 };
    }
    if (t.includes('FROM media_post_assets WHERE post_id')) {
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });
}

function updateTexts() {
  return mockQuery.mock.calls.map(([text]) => String(text || ''));
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

test('admin_removed post restores as before (no counter-notice needed)', async () => {
  mockRestoreDb({ moderation_state: 'admin_removed' });
  const res = await request(app).post('/api/admin/media/posts/post-1/restore').send({ reason: 'Takedown was a mistake' });
  expect(res.status).toBe(200);
  expect(res.body.restored).toBe(true);
  expect(auditService.logAdminAction).toHaveBeenCalled();
});

test('dmca_removed post restores when a counter-notice reference is supplied', async () => {
  mockRestoreDb({ moderation_state: 'dmca_removed' });
  const res = await request(app)
    .post('/api/admin/media/posts/post-1/restore')
    .send({ reason: 'Counter-notice received and verified', counterNoticeRef: 'CN-2026-10-14-001' });
  expect(res.status).toBe(200);
  expect(res.body.restored).toBe(true);
  // The DMCA revocation markers must be lifted too, not just admin_removed.
  const assetUpdate = updateTexts().find((t) => t.includes('UPDATE media_post_assets'));
  expect(assetUpdate).toContain("'dmca_removed'");
  const cleanupUpdate = updateTexts().find((t) => t.includes('UPDATE media_asset_cleanup_jobs'));
  expect(cleanupUpdate).toContain("'dmca_removed'");
  // The counter-notice reference is recorded in the audit trail.
  const auditCall = auditService.logAdminAction.mock.calls[0][0];
  expect(auditCall.after.counter_notice_ref).toBe('CN-2026-10-14-001');
  expect(auditCall.before.moderation_state).toBe('dmca_removed');
});

test('dmca_removed post without a counter-notice reference is rejected (400)', async () => {
  mockRestoreDb({ moderation_state: 'dmca_removed' });
  const res = await request(app)
    .post('/api/admin/media/posts/post-1/restore')
    .send({ reason: 'Looks fine to me' });
  expect(res.status).toBe(400);
  expect(res.body.code).toBe('media_restore_dmca_ref_required');
  expect(updateTexts().some((t) => t.includes('UPDATE media_posts'))).toBe(false);
});

test('dmca_removed post with a too-short counter-notice reference is rejected (400)', async () => {
  mockRestoreDb({ moderation_state: 'dmca_removed' });
  const res = await request(app)
    .post('/api/admin/media/posts/post-1/restore')
    .send({ reason: 'Looks fine to me', counterNoticeRef: 'abc' });
  expect(res.status).toBe(400);
  expect(res.body.code).toBe('media_restore_dmca_ref_required');
});

test('safety_blocked post still cannot be restored (409)', async () => {
  mockRestoreDb({ moderation_state: 'safety_blocked' });
  const res = await request(app)
    .post('/api/admin/media/posts/post-1/restore')
    .send({ reason: 'Admin override attempt', counterNoticeRef: 'CN-2026-10-14-001' });
  expect(res.status).toBe(409);
  expect(res.body.code).toBe('media_restore_safety_blocked');
});

test('csam-flagged post still cannot be restored (409)', async () => {
  mockRestoreDb({ moderation_state: 'admin_removed', csam_status: 'flagged' });
  const res = await request(app)
    .post('/api/admin/media/posts/post-1/restore')
    .send({ reason: 'Admin override attempt' });
  expect(res.status).toBe(409);
  expect(res.body.code).toBe('media_restore_safety_blocked');
});
