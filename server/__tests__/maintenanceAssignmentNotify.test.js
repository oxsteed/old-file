'use strict';

/**
 * maintenanceAssignmentNotify.test.js
 *
 * Review P2-9-F06: when a maintenance request is newly assigned to a
 * helper, the helper must be notified (the GET /assigned queue is the
 * durable surface; the notification is the push). Re-assignment to a
 * different helper notifies the new assignee; non-assignment updates do
 * not notify.
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../utils/businessOwnership', () => ({
  canAccessBusinessTeam: jest.fn().mockResolvedValue({ role: 'owner' }),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn(),
}));

const { sendNotification } = require('../services/notificationService');
const controller = require('../controllers/maintenanceRequestController');

const OWNER_ID = '00000000-0000-4000-8000-000000000111';
const HELPER_A = '00000000-0000-4000-8000-000000000aaa';
const HELPER_B = '00000000-0000-4000-8000-000000000bbb';

function existingRequest(overrides = {}) {
  return {
    id: 55,
    business_id: 9,
    business_owner_id: OWNER_ID,
    business_name: 'Sunset Apts',
    title: 'Leaky faucet',
    status: 'reported',
    assigned_helper_id: null,
    ...overrides,
  };
}

function routeQueries(existing) {
  const clientQuery = jest.fn(async (sql, params = []) => {
    const text = String(sql);
    if (text.includes('FOR UPDATE')) return { rows: [existingRequest(existing)] };
    if (text.startsWith('UPDATE property_maintenance_requests')) {
      const updated = { ...existingRequest(existing), assigned_helper_id: params[1] };
      return { rows: [updated] };
    }
    return { rows: [], rowCount: 0 };
  });
  mockQuery.mockImplementation(async (sql) => {
    if (String(sql).trim().toUpperCase() === 'BEGIN') return { rows: [] };
    return { rows: [], rowCount: 0 };
  });
  const { Pool } = require('pg');
  Pool.mockConnect.mockResolvedValue({ query: clientQuery, release: jest.fn() });
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: OWNER_ID };
    next();
  });
  app.patch('/maintenance-requests/:id', controller.updateRequest);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  sendNotification.mockResolvedValue({ success: true });
  const { Pool } = require('pg');
  Pool.mockConnect.mockClear();
});

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe('maintenance assignment notification', () => {
  test('newly assigning a helper notifies that helper', async () => {
    routeQueries({ assigned_helper_id: null });
    const res = await request(buildApp())
      .patch('/maintenance-requests/55')
      .send({ assigned_helper_id: HELPER_A });
    await flush();

    expect(res.status).toBe(200);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: HELPER_A,
      type: 'maintenance_request_assigned',
      action_url: '/helper-dashboard?tab=pulse',
      idempotencyKey: `maintenance-assigned:55:${HELPER_A}`,
    }));
  });

  test('re-assigning to a different helper notifies the new assignee only', async () => {
    routeQueries({ assigned_helper_id: HELPER_A });
    const res = await request(buildApp())
      .patch('/maintenance-requests/55')
      .send({ assigned_helper_id: HELPER_B });
    await flush();

    expect(res.status).toBe(200);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification.mock.calls[0][0].userId).toBe(HELPER_B);
  });

  test('updates without an assignment change do not notify', async () => {
    routeQueries({ assigned_helper_id: HELPER_A });
    const res = await request(buildApp())
      .patch('/maintenance-requests/55')
      .send({ assigned_helper_id: HELPER_A, status: 'in_progress' });
    await flush();

    expect(res.status).toBe(200);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  test('unassigning does not notify', async () => {
    routeQueries({ assigned_helper_id: HELPER_A });
    // assignedHelperId falls back to existing when the body omits it; an
    // explicit empty value clears it.
    const res = await request(buildApp())
      .patch('/maintenance-requests/55')
      .send({ assigned_helper_id: '' });
    await flush();

    expect(res.status).toBe(200);
    // '' is falsy so the controller keeps the existing assignee -> no change -> no notify.
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
