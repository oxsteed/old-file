'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

const audits = require('../controllers/restaurantAuditsController');

const USER_ID = '00000000-0000-4000-8000-000000000123';
const RESTAURANT_ID = 9;

function access(role = 'owner') {
  return { id: RESTAURANT_ID, business_id: 42, effective_role: role };
}

function app() {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    req.user = { id: USER_ID, email: 'owner@example.com' };
    next();
  });
  server.post('/api/restaurants/:restaurantId/audits/templates', audits.createTemplate);
  server.post('/api/restaurants/:restaurantId/audits/templates/:templateId/runs', audits.startAudit);
  server.post('/api/restaurants/:restaurantId/audits/runs/:auditId/score', audits.scoreItem);
  server.post('/api/restaurants/:restaurantId/audits/runs/:auditId/complete', audits.completeAudit);
  server.post('/api/restaurants/:restaurantId/audits/runs/:auditId/findings', audits.addFinding);
  server.post('/api/restaurants/:restaurantId/audits/findings/:findingId/actions', audits.createCorrectiveAction);
  server.patch('/api/restaurants/:restaurantId/audits/corrective-actions/:actionId', audits.updateCorrectiveAction);
  server.use(errorHandler);
  return server;
}

beforeEach(() => resetMocks());

describe('restaurant audits backend', () => {
  test('createTemplate requires a name; employees are blocked', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [access('owner')] });
    const noName = await request(app()).post(`/api/restaurants/${RESTAURANT_ID}/audits/templates`).send({});
    expect(noName.status).toBe(400);

    mockQuery.mockResolvedValueOnce({ rows: [access('employee')] });
    const blocked = await request(app())
      .post(`/api/restaurants/${RESTAURANT_ID}/audits/templates`)
      .send({ name: 'Kitchen inspection' });
    expect(blocked.status).toBe(403);
  });

  test('startAudit 404s on unknown template', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [access('manager')] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app()).post(`/api/restaurants/${RESTAURANT_ID}/audits/templates/999/runs`);
    expect(res.status).toBe(404);
  });

  test('scoreItem clamps to max_score and rejects closed audits', async () => {
    const audit = { id: 5, restaurant_id: RESTAURANT_ID, template_id: 2, status: 'in_progress' };
    const item = { id: 8, template_id: 2, label: 'Floors', max_score: 5, weight: 1 };
    mockQuery
      .mockResolvedValueOnce({ rows: [access('employee')] })
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [audit] })
      .mockResolvedValueOnce({ rows: [item] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app())
      .post(`/api/restaurants/${RESTAURANT_ID}/audits/runs/5/score`)
      .send({ itemId: 8, score: 99 });
    expect(res.status).toBe(200);
    expect(res.body.score).toBe(5);

    mockQuery
      .mockResolvedValueOnce({ rows: [access('employee')] })
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ ...audit, status: 'completed' }] });
    const closed = await request(app())
      .post(`/api/restaurants/${RESTAURANT_ID}/audits/runs/5/score`)
      .send({ itemId: 8, score: 3 });
    expect(closed.status).toBe(409);
  });

  test('completeAudit computes weighted totals', async () => {
    const audit = { id: 5, restaurant_id: RESTAURANT_ID, template_id: 2, status: 'in_progress' };
    mockQuery
      .mockResolvedValueOnce({ rows: [access('manager')] })
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [audit] })
      .mockResolvedValueOnce({ rows: [{ total: '14', max: '20' }] })
      .mockResolvedValueOnce({ rows: [{ ...audit, status: 'completed', total_score: '14', max_score: '20' }] });
    const res = await request(app()).post(`/api/restaurants/${RESTAURANT_ID}/audits/runs/5/complete`);
    expect(res.status).toBe(200);
    expect(res.body.audit.status).toBe('completed');
  });

  test('addFinding requires a note', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [access('employee')] })
      .mockResolvedValueOnce({ rows: [{ id: 5, status: 'in_progress' }] });
    const res = await request(app())
      .post(`/api/restaurants/${RESTAURANT_ID}/audits/runs/5/findings`)
      .send({ severity: 'high', note: '   ' });
    expect(res.status).toBe(400);
  });

  test('addFinding replays on clientKey instead of duplicating', async () => {
    // Pre-check finds an existing row -> 200 replayed, no insert.
    mockQuery
      .mockResolvedValueOnce({ rows: [access('employee')] })
      .mockResolvedValueOnce({ rows: [{ id: 5, status: 'in_progress' }] })
      .mockResolvedValueOnce({ rows: [{ id: 21, note: 'Spill near fryer' }] });
    const replayed = await request(app())
      .post(`/api/restaurants/${RESTAURANT_ID}/audits/runs/5/findings`)
      .send({ note: 'Spill near fryer', clientKey: 'abc-123' });
    expect(replayed.status).toBe(200);
    expect(replayed.body.replayed).toBe(true);
    expect(replayed.body.finding.id).toBe(21);
  });

  test('only managers can verify a corrective action', async () => {
    const action = { id: 3, restaurant_id: RESTAURANT_ID, assignee_id: USER_ID, status: 'resolved' };
    // Assignee (non-manager) tries to verify -> 403.
    mockQuery
      .mockResolvedValueOnce({ rows: [access('employee')] })
      .mockResolvedValueOnce({ rows: [action] });
    const blocked = await request(app())
      .patch(`/api/restaurants/${RESTAURANT_ID}/audits/corrective-actions/3`)
      .send({ status: 'verified' });
    expect(blocked.status).toBe(403);

    // Manager verifies -> ok.
    mockQuery
      .mockResolvedValueOnce({ rows: [access('manager')] })
      .mockResolvedValueOnce({ rows: [action] })
      .mockResolvedValueOnce({ rows: [{ ...action, status: 'verified' }] });
    const ok = await request(app())
      .patch(`/api/restaurants/${RESTAURANT_ID}/audits/corrective-actions/3`)
      .send({ status: 'verified' });
    expect(ok.status).toBe(200);
    expect(ok.body.action.status).toBe('verified');
  });

  test('strangers cannot move someone elses action', async () => {
    const action = { id: 4, restaurant_id: RESTAURANT_ID, assignee_id: 'someone-else', status: 'open' };
    mockQuery
      .mockResolvedValueOnce({ rows: [access('employee')] })
      .mockResolvedValueOnce({ rows: [action] });
    const res = await request(app())
      .patch(`/api/restaurants/${RESTAURANT_ID}/audits/corrective-actions/4`)
      .send({ status: 'in_progress' });
    expect(res.status).toBe(403);
  });
});
