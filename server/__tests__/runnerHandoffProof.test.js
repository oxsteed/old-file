'use strict';

/**
 * P2-4-F07: the runner handoff proof gate must not accept an arbitrary
 * method string or any truthy metadata blob as proof. Tasks with
 * requires_proof=true need a method from the shared allowlist plus a
 * written note; anything else is rejected before the task completes.
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../services/socketService', () => ({
  broadcastRestaurant: jest.fn(),
  broadcastToBusinessInbox: jest.fn(),
}));

const appFlow = require('../controllers/restaurantAppFlowController');

const USER_ID = '00000000-0000-4000-8000-000000000123';

function accessRow() {
  return {
    id: 3,
    business_id: 42,
    display_name: 'Ox Burger Lab',
    status: 'active',
    effective_role: 'owner',
    owner_user_id: USER_ID,
    business_owner_id: USER_ID,
  };
}

function taskRow(overrides = {}) {
  return {
    id: 7,
    restaurant_id: 3,
    status: 'En route',
    assigned_to: USER_ID,
    requires_proof: true,
    food_order_id: null,
    ...overrides,
  };
}

function routeQueries({ task }) {
  mockQuery.mockImplementation((sql) => {
    if (/FROM food_restaurants fr/.test(sql)) return Promise.resolve({ rows: [accessRow()] });
    if (/FROM restaurant_runner_tasks/.test(sql) && /FOR UPDATE/.test(sql)) {
      return Promise.resolve({ rows: [task] });
    }
    if (/UPDATE restaurant_runner_tasks/.test(sql)) {
      return Promise.resolve({ rows: [{ ...task, status: 'Completed' }] });
    }
    if (/INSERT INTO restaurant_runner_proofs/.test(sql)) {
      return Promise.resolve({ rows: [{ id: 99, method: 'photo', note: 'x' }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: USER_ID };
    next();
  });
  app.post('/api/restaurants/:restaurantId/runner/tasks/:taskId/handoff', appFlow.completeRunnerHandoff);
  app.use(errorHandler);
  return app;
}

const proofInserts = () =>
  mockQuery.mock.calls.filter(([sql]) => /INSERT INTO restaurant_runner_proofs/.test(sql));

beforeEach(() => {
  resetMocks();
});

describe('runner handoff proof gate (P2-4-F07)', () => {
  test('rejects a proof-required handoff with no proof at all', async () => {
    routeQueries({ task: taskRow() });
    const res = await request(buildApp())
      .post('/api/restaurants/3/runner/tasks/7/handoff')
      .send({});
    expect(res.status).toBe(400);
    expect(proofInserts()).toHaveLength(0);
  });

  test('rejects an arbitrary method string on a proof-required task', async () => {
    routeQueries({ task: taskRow() });
    const res = await request(buildApp())
      .post('/api/restaurants/3/runner/tasks/7/handoff')
      .send({ method: 'pinkie-swear', note: 'trust me' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(proofInserts()).toHaveLength(0);
  });

  test('rejects truthy-but-empty metadata as proof on a proof-required task', async () => {
    routeQueries({ task: taskRow() });
    const res = await request(buildApp())
      .post('/api/restaurants/3/runner/tasks/7/handoff')
      .send({ metadata: {} });
    expect(res.status).toBe(400);
    expect(proofInserts()).toHaveLength(0);
  });

  test('rejects a known method with no written note on a proof-required task', async () => {
    routeQueries({ task: taskRow() });
    const res = await request(buildApp())
      .post('/api/restaurants/3/runner/tasks/7/handoff')
      .send({ method: 'photo' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('proof_note_required');
    expect(proofInserts()).toHaveLength(0);
  });

  test('accepts an allowlisted method with a note and records the proof', async () => {
    routeQueries({ task: taskRow() });
    const res = await request(buildApp())
      .post('/api/restaurants/3/runner/tasks/7/handoff')
      .send({ method: 'photo', note: 'Left with the receptionist' });
    expect(res.status).toBe(201);
    expect(proofInserts()).toHaveLength(1);
    expect(proofInserts()[0][1][2]).toBe('photo');
  });

  test('a task without requires_proof still completes proof-less', async () => {
    routeQueries({ task: taskRow({ requires_proof: false }) });
    const res = await request(buildApp())
      .post('/api/restaurants/3/runner/tasks/7/handoff')
      .send({});
    expect(res.status).toBe(201);
    expect(proofInserts()).toHaveLength(0);
  });
});
