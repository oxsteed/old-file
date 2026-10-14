'use strict';

/**
 * P3-6-F11: helper gallery POST must run the gallery URL through the same
 * https + storage/CDN host allowlist (validateMediaUrl) as profile/cover
 * photos instead of storing an arbitrary URL verbatim.
 */

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'helper-123' }; next(); },
}));
jest.mock('../middleware/requireRole', () => () => (_req, _res, next) => next());
jest.mock('../middleware/rateLimiter', () => ({ generalLimiter: (_req, _res, next) => next() }));
jest.mock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const express = require('express');
const request = require('supertest');
const pool = require('../db');

const router = require('../routes/helperProfile');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/helper-profile', router);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('rejects a gallery URL that fails the media allowlist', async () => {
  const res = await request(buildApp())
    .post('/api/helper-profile/gallery')
    .send({ url: 'http://evil.example/bad.jpg' });
  expect(res.status).toBe(400);
  expect(pool.query).not.toHaveBeenCalled();
});

test('stores the validated gallery URL', async () => {
  pool.query.mockResolvedValueOnce({
    rows: [{ id: 1, user_id: 'helper-123', url: 'https://www.oxsteed.com/photos/g1.jpg', caption: null, sort_order: 0 }],
  });
  const res = await request(buildApp())
    .post('/api/helper-profile/gallery')
    .send({ url: 'https://www.oxsteed.com/photos/g1.jpg' });
  expect(res.status).toBe(201);
  expect(pool.query).toHaveBeenCalledWith(
    expect.stringContaining('INSERT INTO helper_gallery'),
    ['helper-123', 'https://www.oxsteed.com/photos/g1.jpg', null, 0]
  );
});
