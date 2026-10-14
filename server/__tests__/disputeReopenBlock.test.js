'use strict';

// P3-2-F09: resolved disputes are terminal and cannot be re-opened.
const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/supportTicketLinkService', () => ({
  createLinkedSupportTicket: jest.fn(),
}));

const disputeController = require('../controllers/disputeController');
const { createLinkedSupportTicket } = require('../services/supportTicketLinkService');

const USER_ID = '00000000-0000-4000-8000-000000000123';
const JOB_ID = '00000000-0000-4000-8000-000000000456';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: USER_ID, role: 'customer', email: 'customer@example.com' };
    next();
  });
  app.post('/api/disputes/jobs/:jobId', disputeController.openDispute);
  app.use(errorHandler);
  return app;
}

const JOB_ROW = {
  id: JOB_ID,
  title: 'Kitchen repair',
  status: 'completed',
  client_id: USER_ID,
  assigned_helper_id: '00000000-0000-4000-8000-000000000321',
  completed_at: null,
};

function mockAuth() {
  mockQuery
    .mockResolvedValueOnce({ rows: [JOB_ROW] })
    .mockResolvedValueOnce({ rows: [{ first_name: 'Test', last_name: 'Customer', email: 'customer@example.com' }] });
}

function openBody() {
  return {
    reason: 'work_not_completed',
    description: 'The helper left the sink leaking and never came back to fix it.',
  };
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  createLinkedSupportTicket.mockResolvedValue({
    id: '00000000-0000-4000-8000-000000000999',
    ticket_number: 'SUP-100',
  });
});

test('a resolved dispute cannot be re-opened', async () => {
  mockAuth();
  mockQuery
    .mockResolvedValueOnce({ rows: [JOB_ROW] }) // job lock
    .mockResolvedValueOnce({ rows: [{ id: 9, status: 'resolved' }] }); // existing dispute

  const res = await request(buildApp()).post(`/api/disputes/jobs/${JOB_ID}`).send(openBody());
  expect(res.status).toBe(409);
  expect(res.body.code).toBe('dispute_already_resolved');
});

test('an open dispute still blocks a second dispute', async () => {
  mockAuth();
  mockQuery
    .mockResolvedValueOnce({ rows: [JOB_ROW] })
    .mockResolvedValueOnce({ rows: [{ id: 9, status: 'open' }] });

  const res = await request(buildApp()).post(`/api/disputes/jobs/${JOB_ID}`).send(openBody());
  expect(res.status).toBe(409);
  expect(res.body.code).toBe('already_exists');
});

test('a closed (withdrawn) dispute does not block a fresh dispute', async () => {
  mockAuth();
  const newDispute = { id: 11, job_id: JOB_ID, status: 'open' };
  mockQuery
    .mockResolvedValueOnce({ rows: [JOB_ROW] }) // job lock
    // The DB-side `status <> 'closed'` filter drops the withdrawn dispute.
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] }) // P1-3-F08 barrier: no signed agreement
    .mockResolvedValueOnce({ rows: [newDispute] }) // insert
    .mockResolvedValueOnce({ rows: [] }) // link support ticket
    .mockResolvedValueOnce({ rows: [] }) // escrow hold lookup: no payment
    .mockResolvedValueOnce({ rows: [] }); // admin notification lookup

  const res = await request(buildApp()).post(`/api/disputes/jobs/${JOB_ID}`).send(openBody());
  expect(res.status).toBe(201);
  expect(res.body.dispute.id).toBe(11);
});
