'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../utils/storage', () => ({
  getSignedDownloadUrl: jest.fn(async (key) => `/signed/${key}`),
  uploadFile: jest.fn(),
  deleteFile: jest.fn(),
}));

const pool = require('../db');
const media = require('../controllers/mediaController');
const assets = require('../controllers/mediaAssetController');
const { sendNotification } = require('../services/notificationService');

function response() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

beforeEach(() => {
  pool.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  pool.connect.mockReset();
  sendNotification.mockClear();
});

describe('Media user journeys', () => {
  test('rejects an oversized photo through the structured upload API', async () => {
    const app = express();
    app.post('/upload', assets.mediaPhotoUploadHandler, assets.uploadPhoto);
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ code: err.code, error: err.message }));

    const result = await request(app)
      .post('/upload')
      .field('post_id', 'post-1')
      .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), { filename: 'large.jpg', contentType: 'image/jpeg' });

    expect(result.status).toBe(413);
    expect(result.body).toMatchObject({ code: 'media_file_too_large' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('blocks video parsing before a non-Didit account can upload a file', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ identity_verified: false }] });
    const next = jest.fn();
    const res = response();

    await assets.requireVideoIdentity({ user: { id: 'guest-user' } }, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_video_didit_required' }));
    expect(next).not.toHaveBeenCalled();
  });

  test('lets a verified actor reply and sends one stable notification to the parent owner', async () => {
    const actor = {
      id: 'actor-1', owner_user_id: 'replyer', actor_type: 'helper', verified_kind: 'identity',
      handle: 'replyer', display_name: 'Replyer', avatar_url: null,
    };
    const post = {
      id: 'reply-1', actor_id: 'actor-1', parent_id: 'parent-1', body: 'Helpful reply',
      visibility: 'public', processing_status: 'ready', csam_status: 'passed',
    };
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT * FROM media_actors WHERE owner_user_id')) return { rows: [actor] };
      if (sql.includes('helper_profiles hp JOIN users u')) return { rows: [{ id: 'replyer' }] };
      if (sql.includes('COUNT(*) AS c')) return { rows: [{ c: '0' }] };
      if (sql.includes('SELECT p.id FROM media_posts')) return { rows: [{ id: 'parent-1' }] };
      if (sql.includes('INSERT INTO media_posts')) return { rows: [post] };
      if (sql.includes('SELECT a.owner_user_id')) return { rows: [{ owner_user_id: 'parent-owner' }] };
      if (sql.includes('SELECT * FROM media_post_links')) return { rows: [] };
      if (sql.includes('SELECT * FROM media_post_assets')) return { rows: [] };
      return { rows: [], rowCount: 1 };
    });
    const res = response();

    await media.createPost({
      user: { id: 'replyer' },
      body: { body: 'Helpful reply', parent_id: 'parent-1' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'parent-owner',
      type: 'media_reply',
      idempotencyKey: 'media_reply:parent-1:parent-owner',
    }));
  });
});
