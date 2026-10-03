'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

const training = require('../controllers/restaurantTrainingController');

const USER_ID = '00000000-0000-4000-8000-000000000123';
const STAFF_ID = '00000000-0000-4000-8000-000000000456';
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
  server.get('/api/restaurants/:restaurantId/training/modules', training.listModules);
  server.post('/api/restaurants/:restaurantId/training/modules', training.createModule);
  server.post('/api/restaurants/:restaurantId/training/modules/:moduleId/assign', training.assignModule);
  server.get('/api/restaurants/:restaurantId/training/assignments', training.listAssignments);
  server.post('/api/restaurants/:restaurantId/training/assignments/:assignmentId/submit', training.submitQuiz);
  server.use(errorHandler);
  return server;
}

beforeEach(() => resetMocks());

describe('restaurant training backend', () => {
  test('non-managers do not see quiz answers', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [access('employee')] })
      .mockResolvedValueOnce({ rows: [{ id: 1, title: 'Food safety', restaurant_id: RESTAURANT_ID }] })
      .mockResolvedValueOnce({ rows: [{ id: 7, module_id: 1, question: 'Q?', options: ['a', 'b'], correct_index: 1, sort_order: 0 }] });
    const res = await request(app()).get(`/api/restaurants/${RESTAURANT_ID}/training/modules`);
    expect(res.status).toBe(200);
    expect(res.body.modules[0].questions[0]).not.toHaveProperty('correct_index');
    expect(res.body.modules[0].questions[0].options).toEqual(['a', 'b']);
  });

  test('managers see quiz answers', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [access('manager')] })
      .mockResolvedValueOnce({ rows: [{ id: 1, title: 'Food safety', restaurant_id: RESTAURANT_ID }] })
      .mockResolvedValueOnce({ rows: [{ id: 7, module_id: 1, question: 'Q?', options: ['a', 'b'], correct_index: 1, sort_order: 0 }] });
    const res = await request(app()).get(`/api/restaurants/${RESTAURANT_ID}/training/modules`);
    expect(res.status).toBe(200);
    expect(res.body.modules[0].questions[0].correct_index).toBe(1);
  });

  test('createModule requires a title and valid category', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [access('owner')] });
    const noTitle = await request(app()).post(`/api/restaurants/${RESTAURANT_ID}/training/modules`).send({});
    expect(noTitle.status).toBe(400);

    mockQuery.mockResolvedValueOnce({ rows: [access('owner')] });
    const badCat = await request(app())
      .post(`/api/restaurants/${RESTAURANT_ID}/training/modules`)
      .send({ title: 'T', category: 'nope' });
    expect(badCat.status).toBe(400);
  });

  test('employees cannot create modules', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [access('employee')] });
    const res = await request(app())
      .post(`/api/restaurants/${RESTAURANT_ID}/training/modules`)
      .send({ title: 'T' });
    expect(res.status).toBe(403);
  });

  test('assignModule upserts and rejects unknown staff', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [access('owner')] })
      .mockResolvedValueOnce({ rows: [{ id: 3 }] })
      .mockResolvedValueOnce({ rows: [] });
    const notFound = await request(app())
      .post(`/api/restaurants/${RESTAURANT_ID}/training/modules/3/assign`)
      .send({ userId: 'nope' });
    expect(notFound.status).toBe(404);

    mockQuery
      .mockResolvedValueOnce({ rows: [access('owner')] })
      .mockResolvedValueOnce({ rows: [{ id: 3 }] })
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [{ id: 11, module_id: 3, user_id: STAFF_ID, status: 'assigned' }] });
    const ok = await request(app())
      .post(`/api/restaurants/${RESTAURANT_ID}/training/modules/3/assign`)
      .send({ userId: STAFF_ID });
    expect(ok.status).toBe(201);
    expect(ok.body.assignment.status).toBe('assigned');
  });

  test('submitQuiz scores transactionally and blocks double submit', async () => {
    const assignment = { id: 11, module_id: 3, user_id: USER_ID, status: 'assigned', pass_score_pct: 80 };
    // First submit: 1/2 correct = 50% < 80% -> failed but completed.
    mockQuery
      .mockResolvedValueOnce({ rows: [access('employee')] })
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [assignment] })
      .mockResolvedValueOnce({ rows: [{ correct_index: 0 }, { correct_index: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 99, score_pct: 50, passed: false }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app())
      .post(`/api/restaurants/${RESTAURANT_ID}/training/assignments/11/submit`)
      .send({ answers: [0, 0] });
    expect(res.status).toBe(200);
    expect(res.body.scorePct).toBe(50);
    expect(res.body.passed).toBe(false);

    // Second submit on a completed assignment -> 409.
    mockQuery
      .mockResolvedValueOnce({ rows: [access('employee')] })
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ ...assignment, status: 'completed' }] });
    const dup = await request(app())
      .post(`/api/restaurants/${RESTAURANT_ID}/training/assignments/11/submit`)
      .send({ answers: [0, 1] });
    expect(dup.status).toBe(409);
  });

  test('staff only see their own assignments', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [access('employee')] });
    await request(app()).get(`/api/restaurants/${RESTAURANT_ID}/training/assignments`);
    const lastCall = mockQuery.mock.calls[mockQuery.mock.calls.length - 1];
    expect(lastCall[0]).toMatch(/a\.user_id = \$2/);
    expect(lastCall[1]).toEqual([RESTAURANT_ID, USER_ID]);
  });
});
