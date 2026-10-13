'use strict';

// Review P1-3-F08: the complaint barrier. A signed work agreement is the
// first stop for work-quality complaints: opening a dispute must route
// through the agreement's warranty first. Safety and fraud skip the barrier.

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
const AGREEMENT_ID = '00000000-0000-4000-8000-000000000aaa';

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

const body = (reason) => ({
  reason,
  description: 'The agreed work was not completed after the scheduled visit.',
});

// Auth + profile + in-transaction lock + existing-dispute check.
function mockPreamble() {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: JOB_ID, title: 'Kitchen repair', status: 'in_progress', client_id: USER_ID, assigned_helper_id: 'h2' }] })
    .mockResolvedValueOnce({ rows: [{ first_name: 'Test', last_name: 'Customer', email: 'customer@example.com' }] })
    .mockResolvedValueOnce({ rows: [{ id: JOB_ID, title: 'Kitchen repair' }] })
    .mockResolvedValueOnce({ rows: [] });
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  createLinkedSupportTicket.mockResolvedValue({ id: 'tick-1', ticket_number: 'SUP-100' });
});

test('dispute is refused when a signed agreement has no warranty claim', async () => {
  mockPreamble();
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: AGREEMENT_ID }] }) // active agreement
    .mockResolvedValueOnce({ rows: [] });                    // no warranty claim

  const res = await request(buildApp()).post(`/api/disputes/jobs/${JOB_ID}`).send(body('poor_quality'));

  expect(res.status).toBe(409);
  expect(res.body.code).toBe('warranty_claim_required');
  expect(res.body.fields.agreement_id).toBe(AGREEMENT_ID);
  expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO disputes/.test(String(sql)))).toBe(false);
});

test('dispute proceeds after a warranty claim was filed', async () => {
  const dispute = { id: 7, job_id: JOB_ID, status: 'open' };
  mockPreamble();
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: AGREEMENT_ID }] }) // active agreement
    .mockResolvedValueOnce({ rows: [{ id: 'claim-1' }] })    // warranty claim filed
    .mockResolvedValueOnce({ rows: [dispute] })              // INSERT dispute
    .mockResolvedValueOnce({ rows: [] })                     // UPDATE support_ticket_id
    .mockResolvedValueOnce({ rows: [] });                    // escrow hold check

  const res = await request(buildApp()).post(`/api/disputes/jobs/${JOB_ID}`).send(body('poor_quality'));

  expect(res.status).toBe(201);
  expect(res.body.dispute.id).toBe(7);
});

test('safety and fraud skip the barrier', async () => {
  for (const reason of ['safety_concern', 'fraud']) {
    resetMocks();
    jest.clearAllMocks();
    createLinkedSupportTicket.mockResolvedValue({ id: 'tick-1', ticket_number: 'SUP-100' });
    const dispute = { id: 8, job_id: JOB_ID, status: 'open' };
    mockPreamble();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: AGREEMENT_ID }] }) // active agreement, no claim
      .mockResolvedValueOnce({ rows: [dispute] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).post(`/api/disputes/jobs/${JOB_ID}`).send(body(reason));

    expect(res.status).toBe(201);
    // the warranty-claim lookup must not run for bypass reasons
    expect(
      mockQuery.mock.calls.some(([sql]) => /FROM work_agreement_warranty_claims/.test(String(sql)))
    ).toBe(false);
  }
});

test('no agreement means no barrier', async () => {
  const dispute = { id: 9, job_id: JOB_ID, status: 'open' };
  mockPreamble();
  mockQuery
    .mockResolvedValueOnce({ rows: [] }) // no signed agreement
    .mockResolvedValueOnce({ rows: [dispute] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });

  const res = await request(buildApp()).post(`/api/disputes/jobs/${JOB_ID}`).send(body('overcharged'));

  expect(res.status).toBe(201);
});
