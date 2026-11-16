'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const discoverController = require('../controllers/discoverController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.get('/api/discover', discoverController.discoverSearch);
  app.get('/api/discover/popular', discoverController.discoverPopular);
  return app;
}

afterEach(() => {
  delete process.env.ACCESS_PROJECTION_ENABLED;
  delete process.env.ACCESS_PILOT_USER_IDS;
  resetMocks();
});

test('unified discovery uses the capability-aware helper boundary when projection is enabled', async () => {
  process.env.ACCESS_PROJECTION_ENABLED = 'true';
  mockQuery.mockResolvedValue({ rows: [] });

  expect((await request(buildApp()).get('/api/discover?q=plumber')).status).toBe(200);
  expect((await request(buildApp()).get('/api/discover/popular')).status).toBe(200);

  const helperQueries = mockQuery.mock.calls
    .map(([sql]) => String(sql))
    .filter((sql) => sql.includes('SELECT u.id') && sql.includes('JOIN helper_profiles hp'));
  expect(helperQueries.length).toBeGreaterThanOrEqual(2);
  for (const sql of helperQueries) {
    expect(sql).toMatch(/access_grants/);
    expect(sql).toMatch(/helper\.offer_services/);
    expect(sql).toMatch(/status = 'active'/);
    expect(sql).toMatch(/expires_at IS NULL OR ag\.expires_at > NOW/);
  }
});

test('discovery keeps the legacy helper role boundary when projection is off', async () => {
  mockQuery.mockResolvedValue({ rows: [] });
  expect((await request(buildApp()).get('/api/discover?q=plumber')).status).toBe(200);

  const helperQuery = mockQuery.mock.calls
    .map(([sql]) => String(sql))
    .find((sql) => sql.includes('SELECT u.id') && sql.includes('JOIN helper_profiles hp'));
  expect(helperQuery).toContain("u.role IN ('helper', 'helper_pro', 'broker')");
  expect(helperQuery).not.toContain('access_grants');
});
