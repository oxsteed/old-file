'use strict';

/**
 * Audit item 7: media moderation delegation checks omitted grantor standing.
 *
 * Both media controllers now delegate to the canonical hasGlobalGrant from
 * adminAuth. These tests drive the real delete (photo) and retry (video)
 * handlers with a fake pool that emulates the canonical GRANT_LOOKUP_SQL
 * semantics: a delegation authorizes only when the grantor is active, not
 * deleted, holds an admin/super_admin role, and (unless super_admin) holds
 * the grant itself. A demoted, deactivated, or deleted grantor's delegation
 * must no longer authorize moderation, while a standing grantor's still does.
 */

const mockGrantFixture = { direct: false, delegation: null };
const mockTxConnect = jest.fn();

jest.mock('../db', () => ({
  query: async (sql) => {
    // Canonical grant lookup (adminAuth GRANT_LOOKUP_SQL): emulate its
    // delegation arm, including grantor standing.
    if (sql.includes('delegation_grants')) {
      const rows = [];
      if (mockGrantFixture.direct) {
        rows.push({ id: 1, region_id: null, grant_source: 'direct' });
      }
      const d = mockGrantFixture.delegation;
      if (d && d.active && !d.deleted
        && (d.role === 'admin' || d.role === 'super_admin')
        && (d.role === 'super_admin' || d.hasGrant)) {
        rows.push({ id: 2, region_id: null, grant_source: 'delegated' });
      }
      return { rows };
    }
    // Retry (video) media lookup.
    if (sql.includes('FROM restaurant_media') && sql.includes('processing_status')) {
      return { rows: [{ id: 'm1', user_id: 'poster-1', media_type: 'video_upload', processing_status: 'failed', csam_status: 'pending', processing_error: 'boom' }] };
    }
    // Delete (photo) media lookup.
    if (sql.includes('FROM restaurant_media')) {
      return { rows: [{ id: 'm1', user_id: 'poster-1' }] };
    }
    // Restaurant-owner check inside the delete handler.
    if (sql.includes('fr.owner_user_id')) {
      return { rows: [] };
    }
    return { rows: [] };
  },
  connect: (...args) => mockTxConnect(...args),
}));

jest.mock('../services/scopeModel', () => ({
  isRestaurantOwner: jest.fn(async () => false),
}));

const mediaController = require('../controllers/restaurantMediaController');
const videoController = require('../controllers/restaurantMediaVideoController');

function fakeTxClient() {
  return {
    query: async (sql) => {
      if (sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 'm1', processing_status: 'failed', csam_status: 'pending' }] };
      }
      if (sql.includes('restaurant_media_processing_jobs') && sql.includes("status = 'failed'")) {
        return { rows: [{ job_type: 'csam_check' }] };
      }
      if (sql.includes('restaurant_media_processing_jobs')) {
        return { rows: [] };
      }
      return { rows: [] };
    },
    release: jest.fn(),
  };
}

function mockReqRes() {
  return {
    req: {
      params: { restaurantId: '5', mediaId: 'm1' },
      user: { id: 'mod-1' },
      isAdmin: true,
      isSuperAdmin: false,
    },
    res: { json: jest.fn() },
    next: jest.fn(),
  };
}

describe('media moderation delegation grantor standing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTxConnect.mockResolvedValue(fakeTxClient());
    mockGrantFixture.direct = false;
    mockGrantFixture.delegation = null;
  });

  test('delete: demoted grantor delegation no longer authorizes', async () => {
    mockGrantFixture.delegation = { active: true, deleted: false, role: 'customer', hasGrant: true };
    const { req, res, next } = mockReqRes();
    await mediaController.deleteRestaurantMedia(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_forbidden' }));
    expect(res.json).not.toHaveBeenCalled();
  });

  test('delete: deactivated grantor delegation no longer authorizes', async () => {
    mockGrantFixture.delegation = { active: false, deleted: false, role: 'admin', hasGrant: true };
    const { req, res, next } = mockReqRes();
    await mediaController.deleteRestaurantMedia(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_forbidden' }));
  });

  test('delete: deleted grantor delegation no longer authorizes', async () => {
    mockGrantFixture.delegation = { active: true, deleted: true, role: 'admin', hasGrant: true };
    const { req, res, next } = mockReqRes();
    await mediaController.deleteRestaurantMedia(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_forbidden' }));
  });

  test('delete: standing admin grantor with the grant still authorizes', async () => {
    mockGrantFixture.delegation = { active: true, deleted: false, role: 'admin', hasGrant: true };
    const { req, res, next } = mockReqRes();
    await mediaController.deleteRestaurantMedia(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('delete: standing super_admin grantor still authorizes without a grant row', async () => {
    mockGrantFixture.delegation = { active: true, deleted: false, role: 'super_admin', hasGrant: false };
    const { req, res, next } = mockReqRes();
    await mediaController.deleteRestaurantMedia(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('delete: direct grant holder still authorizes, and no grant still denies', async () => {
    mockGrantFixture.direct = true;
    const ok = mockReqRes();
    await mediaController.deleteRestaurantMedia(ok.req, ok.res, ok.next);
    expect(ok.next).not.toHaveBeenCalled();
    expect(ok.res.json).toHaveBeenCalledWith({ success: true });

    mockGrantFixture.direct = false;
    const denied = mockReqRes();
    await mediaController.deleteRestaurantMedia(denied.req, denied.res, denied.next);
    expect(denied.next).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_forbidden' }));
  });

  test('retry: demoted grantor delegation no longer authorizes, standing grantor still does', async () => {
    mockGrantFixture.delegation = { active: true, deleted: false, role: 'customer', hasGrant: true };
    const denied = mockReqRes();
    await videoController.retryVideoProcessing(denied.req, denied.res, denied.next);
    expect(denied.next).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_forbidden' }));
    expect(denied.res.json).not.toHaveBeenCalled();

    mockGrantFixture.delegation = { active: true, deleted: false, role: 'admin', hasGrant: true };
    const ok = mockReqRes();
    await videoController.retryVideoProcessing(ok.req, ok.res, ok.next);
    expect(ok.next).not.toHaveBeenCalled();
    expect(ok.res.json).toHaveBeenCalledWith(expect.objectContaining({
      processing_status: 'quarantine',
      retried: true,
    }));
  });
});
