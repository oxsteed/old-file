'use strict';

// Review P1-3-F08 / P1-17-F01: the complaint barrier on the support-ticket
// entry point. A 'dispute'-category support request about a job with a
// signed work agreement and no warranty claim is refused server-side (409
// warranty_claim_required) so the parties use the agreement first. Other
// categories, non-parties, and jobs with a claim pass through.

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../services/supportNotificationService', () => ({
  scheduleSupportMessageNotifications: jest.fn(),
}));

const supportController = require('../controllers/supportController');

const USER_ID = '00000000-0000-4000-8000-000000000111';
const JOB_ID = '00000000-0000-4000-8000-000000000222';
const AGREEMENT_ID = '00000000-0000-4000-8000-000000000333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: USER_ID, role: 'customer', email: 'customer@example.com' };
    next();
  });
  app.post('/api/support/request', supportController.submitSupportRequest);
  app.use(errorHandler);
  return app;
}

const baseBody = (overrides = {}) => ({
  name: 'Test Customer',
  email: 'customer@example.com',
  subject: 'Work complaint',
  message: 'The helper did poor work on my kitchen repair.',
  category: 'dispute',
  job_id: JOB_ID,
  ...overrides,
});

// Authenticated user: no email-link lookup, so the first query is the gate.
function mockTicketInsert() {
  mockQuery
    .mockResolvedValueOnce({ rows: [] }) // BEGIN
    .mockResolvedValueOnce({
      rows: [{ id: 'ticket-1', ticket_number: 1001, subject: 'Work complaint', name: 'Test Customer', priority: 'normal', created_at: new Date().toISOString() }],
    })
    .mockResolvedValueOnce({ rows: [{ id: 'message-1' }] })
    .mockResolvedValueOnce({ rows: [] }); // admin email lookup (emailAdminsNewTicket)
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

test('dispute ticket is refused when a signed agreement has no warranty claim', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: JOB_ID }] }) // job party check
    .mockResolvedValueOnce({ rows: [{ id: AGREEMENT_ID }] }) // signed agreement
    .mockResolvedValueOnce({ rows: [] }); // no warranty claim

  const res = await request(buildApp()).post('/api/support/request').send(baseBody());

  expect(res.status).toBe(409);
  expect(res.body.code).toBe('warranty_claim_required');
  expect(res.body.fields.agreement_id).toBe(AGREEMENT_ID);
  expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO support_tickets/.test(sql))).toBe(false);
});

test('dispute ticket is accepted once a warranty claim exists', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: JOB_ID }] })
    .mockResolvedValueOnce({ rows: [{ id: AGREEMENT_ID }] })
    .mockResolvedValueOnce({ rows: [{ id: 'claim-1' }] });
  mockTicketInsert();

  const res = await request(buildApp()).post('/api/support/request').send(baseBody());

  expect(res.status).toBe(201);
  expect(res.body.ticket_id).toBe('ticket-1');
  const insertCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO support_tickets/.test(sql));
  expect(insertCall).toBeTruthy();
  expect(JSON.parse(insertCall[1][7]).job_id).toBe(JOB_ID);
});

test('non-dispute categories pass through and still record the job link', async () => {
  // The gate only runs for the 'dispute' category; billing questions about
  // the job are legitimate support traffic.
  mockTicketInsert();

  const res = await request(buildApp())
    .post('/api/support/request')
    .send(baseBody({ category: 'billing' }));

  expect(res.status).toBe(201);
  const insertCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO support_tickets/.test(sql));
  expect(JSON.parse(insertCall[1][7]).job_id).toBe(JOB_ID);
});

test('tickets from non-parties are not gated', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] }); // not a party to the job
  mockTicketInsert();

  const res = await request(buildApp()).post('/api/support/request').send(baseBody());

  expect(res.status).toBe(201);
  expect(mockQuery.mock.calls.some(([sql]) => /FROM work_agreements/.test(sql))).toBe(false);
});

test('tickets without a job link are unaffected', async () => {
  mockTicketInsert();

  const res = await request(buildApp())
    .post('/api/support/request')
    .send(baseBody({ job_id: undefined, category: 'dispute' }));

  expect(res.status).toBe(201);
  expect(mockQuery.mock.calls.some(([sql]) => /FROM work_agreements/.test(sql))).toBe(false);
});
