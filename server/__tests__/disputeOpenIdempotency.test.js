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
      // First request transaction: lock, keyed replay lookup, active check,
      // complaint-barrier agreement check, insert.
      .mockResolvedValueOnce({ rows: [{ id: JOB_ID, title: 'Kitchen repair' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) // P1-3-F08: no signed work agreement
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

describe('job dispute 30-day window (P3-2-F09)', () => {
  const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
  const body = {
    reason: 'poor_quality',
    description: 'The paint job was sloppy and two walls were left unfinished.',
  };

  function queueOpenMocks(completedAt) {
    const jobRow = { id: JOB_ID, title: 'Paint job', status: 'completed', client_id: USER_ID, completed_at: completedAt };
    const dispute = { id: 77, job_id: JOB_ID, status: 'open', support_ticket_id: '00000000-0000-4000-8000-000000000999', client_request_id: REQUEST_ID };
    mockQuery
      .mockResolvedValueOnce({ rows: [jobRow] }) // authorization job lookup
      .mockResolvedValueOnce({ rows: [{ first_name: 'Test', last_name: 'Customer', email: 'customer@example.com' }] }) // user profile
      .mockResolvedValueOnce({ rows: [jobRow] }) // locked job row
      .mockResolvedValueOnce({ rows: [] }) // replay lookup
      .mockResolvedValueOnce({ rows: [] }) // existing-dispute check
      .mockResolvedValueOnce({ rows: [dispute] }) // insert dispute
      .mockResolvedValueOnce({ rows: [] }) // link support ticket id
      .mockResolvedValueOnce({ rows: [] }) // escrow hold lookup
      .mockResolvedValueOnce({ rows: [] }); // admin notification lookup
    return dispute;
  }

  test('rejects disputes opened more than 30 days after job completion', async () => {
    queueOpenMocks(daysAgo(40));
    const res = await request(buildApp())
      .post(`/api/disputes/jobs/${JOB_ID}`)
      .set('Idempotency-Key', REQUEST_ID)
      .send(body);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('dispute_window_expired');
    expect(res.body.error).toMatch(/30-day/i);
    // No dispute row may be created once the window has closed.
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO disputes/.test(sql))).toBe(false);
  });

  test('allows disputes within 30 days of completion', async () => {
    queueOpenMocks(daysAgo(5));
    const res = await request(buildApp())
      .post(`/api/disputes/jobs/${JOB_ID}`)
      .set('Idempotency-Key', REQUEST_ID)
      .send(body);
    expect(res.status).toBe(201);
    expect(res.body.dispute).toEqual(expect.objectContaining({ id: 77 }));
  });

  test('allows disputes on jobs that were never completed', async () => {
    queueOpenMocks(null);
    const res = await request(buildApp())
      .post(`/api/disputes/jobs/${JOB_ID}`)
      .set('Idempotency-Key', REQUEST_ID)
      .send(body);
    expect(res.status).toBe(201);
  });
});
