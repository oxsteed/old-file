'use strict';

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
const REQUEST_ID = '00000000-0000-4000-8000-000000000789';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: USER_ID,
      role: 'customer',
      email: 'customer@example.com',
    };
    next();
  });
  app.post('/api/disputes/jobs/:jobId', disputeController.openDispute);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  createLinkedSupportTicket.mockResolvedValue({
    id: '00000000-0000-4000-8000-000000000999',
    ticket_number: 'SUP-100',
  });
});

describe('job dispute creation idempotency', () => {
  test('replays a committed dispute without recreating support or notifications', async () => {
    const dispute = {
      id: 41,
      job_id: JOB_ID,
      status: 'open',
      support_ticket_id: '00000000-0000-4000-8000-000000000999',
      client_request_id: REQUEST_ID,
    };

    mockQuery
      // First request: authorization and user profile.
      .mockResolvedValueOnce({ rows: [{ id: JOB_ID, title: 'Kitchen repair' }] })
      .mockResolvedValueOnce({ rows: [{ first_name: 'Test', last_name: 'Customer', email: 'customer@example.com' }] })
      // First request transaction: lock, keyed replay lookup, active check, insert.
      .mockResolvedValueOnce({ rows: [{ id: JOB_ID, title: 'Kitchen repair' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [dispute] })
      // Link support, hold escrow, and notify admins.
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      // Second request: authorization and user profile.
      .mockResolvedValueOnce({ rows: [{ id: JOB_ID, title: 'Kitchen repair' }] })
      .mockResolvedValueOnce({ rows: [{ first_name: 'Test', last_name: 'Customer', email: 'customer@example.com' }] })
      // Second request transaction: lock and keyed replay recovery.
      .mockResolvedValueOnce({ rows: [{ id: JOB_ID, title: 'Kitchen repair' }] })
      .mockResolvedValueOnce({ rows: [{ ...dispute, support_ticket_number: 'SUP-100' }] });

    const body = {
      reason: 'work_not_completed',
      description: 'The agreed work was not completed after the scheduled visit.',
    };
    const app = buildApp();
    const first = await request(app)
      .post(`/api/disputes/jobs/${JOB_ID}`)
      .set('Idempotency-Key', REQUEST_ID)
      .send(body);
    const second = await request(app)
      .post(`/api/disputes/jobs/${JOB_ID}`)
      .set('Idempotency-Key', REQUEST_ID)
      .send(body);

    expect(first.status).toBe(201);
    expect(first.body).toEqual(expect.objectContaining({ idempotent: false }));
    expect(second.status).toBe(200);
    expect(second.body).toEqual(expect.objectContaining({ idempotent: true }));
    expect(second.body.dispute).toEqual(expect.objectContaining({ id: dispute.id }));
    expect(createLinkedSupportTicket).toHaveBeenCalledTimes(1);
    expect(createLinkedSupportTicket.mock.calls[0][1]).toEqual(expect.objectContaining({
      clientRequestId: REQUEST_ID,
    }));
    expect(mockQuery.mock.calls.filter(([sql]) => /SELECT id FROM users WHERE role IN/.test(sql))).toHaveLength(1);
  });
});
