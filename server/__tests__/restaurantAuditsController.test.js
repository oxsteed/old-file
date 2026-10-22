'use strict';

const express = require('express');
const request = require('supertest');
const {
  mockQuery,
  resetMocks
} = require('./setup');
const {
  errorHandler
} = require('../middleware/errorHandler');
jest.mock('../services/scopeModel', () => ({
  resolveRestaurantAccess: jest.fn()
}));
jest.mock('../services/permissionsService', () => ({
  hasRestaurantPermission: jest.fn()
}));
const scopeModel = require('../services/scopeModel');
const permissions = require('../services/permissionsService');
const audits = require('../controllers/restaurantAuditsController');
const USER_ID = '00000000-0000-4000-8000-000000000123';
const audit = {
  id: 5,
  restaurant_id: 9,
  template_id: 2,
  status: 'in_progress',
  auditor_id: USER_ID,
  snapshot_items: [{
    id: 8,
    label: 'Floors',
    max_score: 5,
    weight: 1
  }]
};
function app() {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    req.user = {
      id: USER_ID
    };
    next();
  });
  server.post('/:restaurantId/templates', audits.createTemplate);
  server.post('/:restaurantId/templates/:templateId/runs', audits.startAudit);
  server.post('/:restaurantId/runs/:auditId/score', audits.scoreItem);
  server.post('/:restaurantId/runs/:auditId/complete', audits.completeAudit);
  server.post('/:restaurantId/runs/:auditId/findings', audits.addFinding);
  server.patch('/:restaurantId/actions/:actionId', audits.updateCorrectiveAction);
  server.use(errorHandler);
  return server;
}
beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  scopeModel.resolveRestaurantAccess.mockResolvedValue({
    id: 9,
    business_id: 42,
    effective_role: 'owner'
  });
  permissions.hasRestaurantPermission.mockResolvedValue(true);
});
test('template names are required and missing management permission denies writes', async () => {
  expect((await request(app()).post('/9/templates').send({})).status).toBe(400);
  permissions.hasRestaurantPermission.mockResolvedValue(false);
  expect((await request(app()).post('/9/templates').send({
    name: 'Kitchen'
  })).status).toBe(403);
});
test('unknown templates cannot start audits', async () => expect((await request(app()).post('/9/templates/999/runs')).status).toBe(404));
test('scoring rejects overflow instead of silently clamping, and rejects closed runs', async () => {
  mockQuery.mockImplementation(async sql => ({
    rows: sql.includes('FROM restaurant_audits WHERE') ? [audit] : []
  }));
  expect((await request(app()).post('/9/runs/5/score').send({
    itemId: 8,
    score: 99
  })).status).toBe(400);
  const valid = await request(app()).post('/9/runs/5/score').send({
    itemId: 8,
    score: 4
  });
  expect(valid.status).toBe(200);
  expect(valid.body.score).toBe(4);
  mockQuery.mockImplementation(async sql => ({
    rows: sql.includes('FROM restaurant_audits WHERE') ? [{
      ...audit,
      status: 'completed'
    }] : []
  }));
  expect((await request(app()).post('/9/runs/5/score').send({
    itemId: 8,
    score: 3
  })).status).toBe(409);
});
test('completeAudit computes weighted totals only after all required items are scored', async () => {
  mockQuery.mockImplementation(async (sql, params) => {
    if (sql.includes('FROM restaurant_audits WHERE')) return {
      rows: [audit]
    };
    if (sql.includes('FROM restaurant_audit_scores')) return {
      rows: [{
        item_id: 8,
        score: 4,
        max_score: 5,
        weight: 1
      }]
    };
    if (sql.startsWith('UPDATE restaurant_audits')) return {
      rows: [{
        ...audit,
        status: 'completed',
        total_score: params[2],
        max_score: params[3]
      }]
    };
    return {
      rows: []
    };
  });
  const response = await request(app()).post('/9/runs/5/complete');
  expect(response.status).toBe(200);
  expect(response.body.audit).toMatchObject({
    total_score: 4,
    max_score: 5
  });
});
test('findings require a note', async () => expect((await request(app()).post('/9/runs/5/findings').send({
  note: ' '
})).status).toBe(400));
test('matching finding retries replay; payload changes conflict', async () => {
  mockQuery.mockImplementation(async sql => ({
    rows: sql.includes('FROM restaurant_audits WHERE') ? [audit] : sql.includes('FROM restaurant_audit_findings WHERE') ? [{
      id: 21,
      note: 'Spill',
      severity: 'medium',
      created_by: USER_ID
    }] : []
  }));
  const replay = await request(app()).post('/9/runs/5/findings').send({
    note: 'Spill',
    clientKey: 'retry'
  });
  expect(replay.status).toBe(200);
  expect(replay.body.replayed).toBe(true);
  expect((await request(app()).post('/9/runs/5/findings').send({
    note: 'Different',
    clientKey: 'retry'
  })).status).toBe(409);
});
test('only an audit manager can verify a resolved corrective action', async () => {
  mockQuery.mockImplementation(async sql => ({
    rows: sql.includes('SELECT ca.*') ? [{
      id: 3,
      assignee_id: USER_ID,
      status: 'resolved'
    }] : sql.startsWith('UPDATE restaurant_corrective_actions') ? [{
      id: 3,
      status: 'verified'
    }] : []
  }));
  permissions.hasRestaurantPermission.mockResolvedValue(false);
  expect((await request(app()).patch('/9/actions/3').send({
    status: 'verified'
  })).status).toBe(403);
  permissions.hasRestaurantPermission.mockResolvedValue(true);
  expect((await request(app()).patch('/9/actions/3').send({
    status: 'verified'
  })).status).toBe(200);
});
test('strangers cannot update another assignee action', async () => {
  permissions.hasRestaurantPermission.mockResolvedValue(false);
  mockQuery.mockImplementation(async sql => ({
    rows: sql.includes('SELECT ca.*') ? [{
      id: 3,
      assignee_id: 'someone-else',
      status: 'open'
    }] : []
  }));
  expect((await request(app()).patch('/9/actions/3').send({
    status: 'in_progress'
  })).status).toBe(403);
});
