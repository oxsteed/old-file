'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { replaceBusinessSkills } = require('../controllers/businessSkillsController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user-123' };
    next();
  });
  app.put('/api/businesses/:businessId/skills', replaceBusinessSkills);
  return app;
}

beforeEach(() => resetMocks());

describe('business skills bulk update', () => {
  test('replaces business skills with a validated list', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 12, owner_id: 'user-123' }] }) // canManageBusinessFinance
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 2 }) // DELETE
      .mockResolvedValueOnce({ rows: [], rowCount: 2 }) // INSERT
      .mockResolvedValueOnce({
        rows: [
          { skill_id: 7, skill_name: 'Electrical', is_required: true },
          { skill_id: 9, skill_name: 'Plumbing', is_required: false },
        ],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

    const res = await request(buildApp())
      .put('/api/businesses/12/skills')
      .send({
        skills: [
          { skillId: 7, isRequired: true, minYearsExperience: 3 },
          { skill_id: 9, is_required: false },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.skills).toHaveLength(2);

    expect(mockQuery.mock.calls[1][0]).toBe('BEGIN');
    expect(mockQuery.mock.calls[2][0]).toMatch(/DELETE FROM business_skills/);
    expect(mockQuery.mock.calls[3][0]).toMatch(/INSERT INTO business_skills/);
    expect(mockQuery.mock.calls[3][1]).toEqual(['12', 7, true, 3, 9, false, null]);
  });

  test('rejects missing skills array', async () => {
    const res = await request(buildApp())
      .put('/api/businesses/12/skills')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('skills array is required');
  });
});
