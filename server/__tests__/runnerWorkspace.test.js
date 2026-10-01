'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const controller = require('../controllers/runnerWorkspaceController');
const teamController = require('../controllers/businessTeamController');
const restaurantRunner = require('../controllers/restaurantRunnerController');

const USER_ID = '00000000-0000-4000-8000-000000000123';

function buildApp() {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: USER_ID };
    next();
  });
  app.get('/api/runner/workspaces', controller.listWorkspaces);
  app.get('/api/runner/inbox', controller.getUnifiedInbox);
  app.get('/api/me/businesses', teamController.getMyBusinesses);
  app.post('/api/me/workspace-context', express.json(), teamController.setWorkspaceContext);
  app.patch('/api/restaurants/:restaurantId/runner/tasks/:taskId/status', express.json(), restaurantRunner.updateTaskStatus);
  app.use(errorHandler);
  return app;
}

beforeEach(() => resetMocks());

test('returns business and restaurant ids for every authorized workspace', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [
    { restaurant_id: 7, business_id: 40, restaurant_name: 'North Kitchen', business_name: 'Ox Group', role: 'employee', membership_id: 2, last_selected_at: null },
    { restaurant_id: 9, business_id: 41, restaurant_name: 'South Kitchen', business_name: 'South Foods', role: 'employee', membership_id: 3, last_selected_at: '2026-06-21T12:00:00Z' },
  ] });

  const res = await request(buildApp()).get('/api/runner/workspaces');

  expect(res.status).toBe(200);
  expect(res.body.workspaces).toHaveLength(2);
  expect(res.body.workspaces[0]).toMatchObject({ restaurant_id: 7, business_id: 40 });
  expect(res.body.selected_restaurant_id).toBe(9);
  expect(mockQuery.mock.calls[0][0]).toMatch(/business_members/);
});

test('persists a physical restaurant only when it belongs to the authorized business', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 40, effective_role: 'employee', membership_id: 2 }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [], rowCount: 1 });

  const res = await request(buildApp())
    .post('/api/me/workspace-context')
    .send({ business_id: 40, restaurant_id: 7 });

  expect(res.status).toBe(200);
  expect(res.body.data).toMatchObject({ business_id: 40, restaurant_id: 7 });
  expect(mockQuery.mock.calls[2][0]).toMatch(/restaurant_id = EXCLUDED\.restaurant_id/);
  expect(mockQuery.mock.calls[2][1]).toEqual([USER_ID, 40, 2, 7]);
});

test('keeps a paused restaurant workspace visible with truthful operating state', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{
      id: 40,
      business_name: 'North Kitchen',
      is_primary: true,
      is_active: true,
      is_listed: false,
      business_kind: 'restaurant',
      business_mode: 'food',
      setup_status: 'active',
      currency_code: 'USD',
      address_country: 'US',
      restaurant_id: 7,
      restaurant_status: 'paused',
      restaurant_discovery_status: 'hidden',
      restaurant_accepts_online_orders: true,
      restaurant_is_accepting_orders_now: false,
      member_count: 2,
    }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });

  const res = await request(buildApp()).get('/api/me/businesses');

  expect(res.status).toBe(200);
  expect(res.body.data.items[0]).toEqual(expect.objectContaining({
    business_id: 40,
    restaurant_id: 7,
    restaurant_status: 'paused',
    restaurant_discovery_status: 'hidden',
    is_listed: false,
    permissions: ['*'],
  }));
});

test('rejects a task update when the task belongs to another runner', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 7, business_id: 40, effective_role: 'employee' }] })
    .mockResolvedValueOnce({ rows: [{ id: 81, restaurant_id: 7, assigned_to: 'another-user', status: 'Ready' }] });

  const res = await request(buildApp())
    .patch('/api/restaurants/7/runner/tasks/81/status')
    .send({ status: 'Picked up' });

  expect(res.status).toBe(403);
  expect(res.body.code).toBe('runner_task_not_assigned');
  expect(mockQuery).toHaveBeenCalledTimes(2);
  expect(mockQuery.mock.calls[1][0]).toMatch(/restaurant_id = \$1 AND id = \$2/);
});

test('rechecks the locked task before completing a delivery', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 7, business_id: 40, effective_role: 'employee' }] })
    .mockResolvedValueOnce({ rows: [{ id: 81, restaurant_id: 7, assigned_to: USER_ID, status: 'En route' }] })
    .mockResolvedValueOnce({ rows: [{ id: 81, restaurant_id: 7, assigned_to: USER_ID, status: 'Ready' }] });

  const res = await request(buildApp())
    .patch('/api/restaurants/7/runner/tasks/81/status')
    .send({ status: 'Completed' });

  expect(res.status).toBe(409);
  expect(res.body.code).toBe('illegal_runner_status_transition');
  expect(mockQuery).toHaveBeenCalledTimes(3);
  expect(mockQuery.mock.calls[2][0]).toMatch(/FOR UPDATE/);
});

test('completes the runner task, order, inventory, and kitchen event in one flow', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 7, business_id: 40, effective_role: 'employee' }] })
    .mockResolvedValueOnce({ rows: [{ id: 81, restaurant_id: 7, assigned_to: USER_ID, status: 'En route', food_order_id: 501, requires_proof: false }] })
    .mockResolvedValueOnce({ rows: [{ id: 81, restaurant_id: 7, assigned_to: USER_ID, status: 'En route', food_order_id: 501, requires_proof: false }] })
    .mockResolvedValueOnce({ rows: [{ id: 81, status: 'Completed', food_order_id: 501 }] })
    .mockResolvedValueOnce({ rows: [{ id: 501, payment_status: 'paid', metadata: { paymentMode: 'pay_at_restaurant' } }] }) // M14 payment gate
    .mockResolvedValueOnce({ rows: [{ id: 501, restaurant_id: 7, status: 'completed', fulfillment_type: 'delivery', business_id: 40 }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });

  const res = await request(buildApp())
    .patch('/api/restaurants/7/runner/tasks/81/status')
    .send({ status: 'Completed', note: 'Delivered to customer' });

  expect(res.status).toBe(200);
  expect(res.body.task).toMatchObject({ id: 81, status: 'Completed' });
  expect(mockQuery.mock.calls[2][0]).toMatch(/FOR UPDATE/);
  expect(mockQuery.mock.calls[3][0]).toMatch(/UPDATE restaurant_runner_tasks/);
  expect(mockQuery.mock.calls[4][0]).toMatch(/SELECT id, payment_status, metadata/);
  expect(mockQuery.mock.calls[5][0]).toMatch(/UPDATE food_orders/);
  expect(mockQuery.mock.calls[7][0]).toMatch(/restaurant_kitchen_events/);
});

test('returns restaurant-labelled offers and assigned tasks across workspaces', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [
      { restaurant_id: 7, business_id: 40, restaurant_name: 'North Kitchen', business_name: 'Ox Group', role: 'employee' },
      { restaurant_id: 9, business_id: 41, restaurant_name: 'South Kitchen', business_name: 'South Foods', role: 'employee' },
    ] })
    .mockResolvedValueOnce({ rows: [{ id: 81, restaurant_id: 9, business_id: 41, restaurant_name: 'South Kitchen', status: 'Ready' }] })
    .mockResolvedValueOnce({ rows: [{ id: 72, restaurant_id: 7, business_id: 40, restaurant_name: 'North Kitchen', assigned_to: USER_ID }] });

  const res = await request(buildApp()).get('/api/runner/inbox');

  expect(res.status).toBe(200);
  expect(res.body.offers[0]).toMatchObject({ restaurant_id: 9, restaurant_name: 'South Kitchen' });
  expect(res.body.assignments[0]).toMatchObject({ restaurant_id: 7, restaurant_name: 'North Kitchen' });
  expect(mockQuery.mock.calls[1][1]).toEqual([USER_ID, 7, 9]);
  expect(mockQuery.mock.calls[2][0]).toMatch(/t\.assigned_to = \$1/);
});

test('returns an empty inbox when the user has no active restaurant access', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });

  const res = await request(buildApp()).get('/api/runner/inbox');

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ workspaces: [], offers: [], assignments: [] });
  expect(mockQuery).toHaveBeenCalledTimes(1);
});
