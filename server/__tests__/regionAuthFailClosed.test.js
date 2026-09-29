'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { loadAssignedRegions, requireRegionAccessForUser } = require('../middleware/regionAuth');

function buildApp() {
  const app = express();
  app.get('/admin/users/:userId',
    (req, _res, next) => {
      req.user = { id: 'admin-1', role: 'admin' };
      req.isSuper = false;
      next();
    },
    loadAssignedRegions,
    requireRegionAccessForUser('userId'),
    (_req, res) => res.json({ ok: true }),
  );
  return app;
}

beforeEach(() => resetMocks());

test('region lookup failures fail closed instead of granting unrestricted access', async () => {
  mockQuery.mockRejectedValueOnce(new Error('database unavailable'));

  const response = await request(buildApp()).get('/admin/users/user-1');

  expect(response.status).toBe(503);
  expect(response.body.code).toBe('region_authorization_unavailable');
});

test('an empty successful region result preserves legacy unrestricted behavior', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });

  const response = await request(buildApp()).get('/admin/users/user-1');

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ ok: true });
});
