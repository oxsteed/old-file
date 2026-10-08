'use strict';

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue(undefined) }));
const pool = require('../db');
const media = require('../controllers/mediaController');
const admin = require('../controllers/mediaAdminController');
const audit = require('../services/auditService');

function response() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe('Media sessions and target access', () => {
  beforeEach(() => pool.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 }));

  test.each(['cookie', 'bearer', 'guest'])('%s public reads resolve personal state without requiring sign-in', async (session) => {
    const viewer = { id: 'viewer-1', is_active: true, role: 'customer' };
    pool.query.mockImplementation(async (sql, params) => {
      if (sql.includes('FROM users u WHERE')) return { rows: [viewer] };
      if (sql.includes('SELECT p.*, a.handle')) return { rows: [{ id: 'post-1', body: 'Local update' }] };
      if (sql.includes('FROM media_likes') || sql.includes('FROM media_bookmarks')) {
        return { rows: params[1] === viewer.id ? [{ found: 1 }] : [] };
      }
      return { rows: [], rowCount: 0 };
    });
    const app = express();
    app.use('/api/media', require('../routes/media'));
    let req = request(app).get('/api/media/posts/post-1');
    const token = jwt.sign({ id: viewer.id }, process.env.JWT_SECRET);
    if (session === 'cookie') req = req.set('Cookie', `oxsteed_access=${token}`);
    if (session === 'bearer') req = req.set('Authorization', `Bearer ${token}`);
    const result = await req;
    expect(result.status).toBe(200);
    expect(result.body.post.liked).toBe(session !== 'guest');
    expect(result.body.post.bookmarked).toBe(session !== 'guest');
    const postQuery = pool.query.mock.calls.find(([sql]) => sql.includes('SELECT p.*, a.handle'));
    expect(postQuery[1]).toEqual(session === 'guest' ? ['post-1'] : ['post-1', viewer.id]);
  });

  test.each(['getReplies', 'getQuotes', 'toggleLike', 'toggleBookmark', 'toggleRepost', 'recordView', 'flagPost'])(
    '%s denies an inaccessible target before reading children or writing actions', async (method) => {
      const res = response();
      await media[method]({ params: { id: 'hidden-post' }, user: { id: 'viewer' }, query: {}, body: {} }, res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query.mock.calls[0][1]).toEqual(['hidden-post', 'viewer']);
    }
  );
});

describe('Media approval preserves safety evidence', () => {
  let client;
  const originalCertification = process.env.MEDIA_CSAM_CERTIFIED;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MEDIA_CSAM_CERTIFIED = 'true';
    client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    pool.connect.mockResolvedValue(client);
  });
  afterAll(() => {
    if (originalCertification === undefined) delete process.env.MEDIA_CSAM_CERTIFIED;
    else process.env.MEDIA_CSAM_CERTIFIED = originalCertification;
  });

  async function approve(postChanges = {}, assetChanges = {}, certified = 'true') {
    process.env.MEDIA_CSAM_CERTIFIED = certified;
    const post = { id: 'post-1', visibility: 'unlisted', processing_status: 'ready', csam_status: 'passed', identity_verified: true, ...postChanges };
    const asset = { asset_type: 'video', processing_status: 'ready', csam_status: 'passed', renditions: [{ storage_key: 'ready.mp4' }], ...assetChanges };
    client.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT p.id')) return { rows: [post] };
      if (sql.includes('SELECT asset_type')) return { rows: [asset] };
      return { rows: [] };
    });
    const res = response();
    await admin.approvePost({ params: { id: post.id }, user: { id: 'admin' }, body: { reason: 'Editorial review complete' } }, res);
    return res;
  }

  test.each([
    [{}, {}, 'false'],
    [{ identity_verified: false }, {}, 'true'],
    [{}, { csam_status: 'flagged' }, 'true'],
    [{}, { csam_status: 'pending' }, 'true'],
    [{}, { processing_status: 'quarantine' }, 'true'],
    [{}, { renditions: [] }, 'true'],
    [{ processing_status: 'quarantine' }, {}, 'true'],
    [{ visibility: 'removed' }, {}, 'true'],
  ])('rejects unsafe publication %#', async (post, asset, certified) => {
    const res = await approve(post, asset, certified);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_safety_pending' }));
    expect(client.query.mock.calls.some(([sql]) => /^\s*(UPDATE|INSERT|DELETE)\b/.test(sql))).toBe(false);
    expect(audit.logAdminAction).not.toHaveBeenCalled();
  });

  test('rejects approval after the actor loses current verification', async () => {
    const res = await approve({ current_actor_verified: false }, {}, 'true');
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_not_verified_poster' }));
    expect(client.query.mock.calls.some(([sql]) => /^\s*(UPDATE|INSERT|DELETE)\b/.test(sql))).toBe(false);
    expect(audit.logAdminAction).not.toHaveBeenCalled();
  });

  test('publishes cleared content without rewriting asset verdicts or completing worker jobs', async () => {
    const res = await approve();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ approved: true }));
    const updates = client.query.mock.calls.filter(([sql]) => sql.includes('UPDATE media_'));
    expect(updates).toHaveLength(1);
    expect(updates[0][0]).not.toMatch(/SET.*csam_status|SET.*processing_status/s);
    expect(audit.logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ client, throwOnError: true }));
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });
});
