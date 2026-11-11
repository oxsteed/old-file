'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const skills = require('../controllers/businessSkillsController');

function buildApp() {
  const app = express();
  app.get('/api/businesses/:businessId/skills', skills.listBusinessSkills);
  app.get('/api/businesses/:businessId/skills/search', skills.searchSkillsForBusiness);
  return app;
}

beforeEach(() => resetMocks());

describe('public business skills visibility', () => {
  test.each([
    '/api/businesses/2/skills',
    '/api/businesses/2/skills/search?q=plumb',
  ])('%s rejects a non-public business before reading skill data', async (path) => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get(path);

    expect(res.status).toBe(404);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toMatch(/JOIN users u ON u\.id = b\.user_id/);
    expect(mockQuery.mock.calls[0][0]).toMatch(/b\.is_listed = TRUE/);
    expect(mockQuery.mock.calls[0][0]).toMatch(/b\.business_kind = 'service'/);
    expect(mockQuery.mock.calls[0][0]).toMatch(/u\.email_verified = TRUE/);
    expect(mockQuery.mock.calls[0][0]).toMatch(/u\.onboarding_completed = TRUE/);
  });

  test('lists skills only after the public business gate passes', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 8, skill_name: 'Plumbing' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const res = await request(buildApp()).get('/api/businesses/1/skills');

    expect(res.status).toBe(200);
    expect(res.body.skills).toEqual([{ id: 8, skill_name: 'Plumbing' }]);
    expect(mockQuery.mock.calls[1][0]).toMatch(/FROM business_skills bs/);
  });

  test('searches skills only after the public business gate passes', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 8, name: 'Plumbing', category: 'home' }] });

    const res = await request(buildApp()).get('/api/businesses/1/skills/search?q=plumb');

    expect(res.status).toBe(200);
    expect(res.body.skills).toEqual([{ id: 8, name: 'Plumbing', category: 'home' }]);
    expect(mockQuery.mock.calls[1][0]).toMatch(/FROM skills_lookup sl/);
  });
});
