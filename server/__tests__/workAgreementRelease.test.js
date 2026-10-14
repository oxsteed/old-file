'use strict';

// Review P1-3-F14: agreement <-> payment/release link. Bilateral agreement
// completion drives the job's release through the same guarded completion
// path the customer would use. Guards fail closed: a blocked release leaves
// funds held while the agreement still completes.

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const { AppError } = require('../middleware/errorHandler');

jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock('../controllers/jobController', () => ({
  completeJobCore: jest.fn(),
  afterJobCompleted: jest.fn(),
}));

const wa = require('../controllers/workAgreementController');
const jobController = require('../controllers/jobController');

const HELPER_ID = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '44444444-4444-4444-8444-444444444444';
const AGREEMENT_ID = '55555555-5555-4555-8555-555555555555';

function buildApp(userId) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId };
    next();
  });
  app.post('/api/work-agreements/:id/complete', wa.completeAgreement);
  app.use(errorHandler);
  return app;
}

const agreementRow = (over = {}) => ({
  id: AGREEMENT_ID,
  job_id: JOB_ID,
  helper_id: HELPER_ID,
  customer_id: CUSTOMER_ID,
  status: 'active',
  ...over,
});

const jobRow = (over = {}) => ({
  id: JOB_ID,
  status: 'in_progress',
  transaction_mode: 'guided_protected',
  payment_rail: 'stripe',
  client_id: CUSTOMER_ID,
  assigned_helper_id: HELPER_ID,
  ...over,
});

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  jobController.completeJobCore.mockResolvedValue({ id: JOB_ID, status: 'completed' });
  jobController.afterJobCompleted.mockResolvedValue(undefined);
});

test('bilateral completion releases held funds through the job completion path', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [agreementRow()] }) // loadAgreement
    .mockResolvedValueOnce({ rows: [agreementRow({ status: 'completed', helper_completed_at: new Date(), customer_completed_at: new Date(), completed_at: new Date() })] }) // complete UPDATE
    .mockResolvedValueOnce({ rows: [jobRow()] }); // release: job lookup

  const res = await request(buildApp(CUSTOMER_ID)).post(`/api/work-agreements/${AGREEMENT_ID}/complete`);

  expect(res.status).toBe(200);
  expect(res.body.awaitingCounterparty).toBe(false);
  expect(jobController.completeJobCore).toHaveBeenCalledTimes(1);
  const args = jobController.completeJobCore.mock.calls[0][0];
  expect(args.jobId).toBe(JOB_ID);
  expect(args.asClient).toBe(true);
  expect(args.actorUserId).toBe(CUSTOMER_ID);
  expect(jobController.afterJobCompleted).toHaveBeenCalledTimes(1);
  expect(res.body.release).toEqual({ released: true, job_status: 'completed' });
});

test('first confirmation does not touch the release path', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [agreementRow()] })
    .mockResolvedValueOnce({ rows: [agreementRow({ status: 'active', helper_completed_at: new Date() })] });

  const res = await request(buildApp(HELPER_ID)).post(`/api/work-agreements/${AGREEMENT_ID}/complete`);

  expect(res.status).toBe(200);
  expect(res.body.awaitingCounterparty).toBe(true);
  expect(res.body.release).toBeNull();
  expect(jobController.completeJobCore).not.toHaveBeenCalled();
});

test('blocked release fails closed: agreement completes, funds stay held', async () => {
  jobController.completeJobCore.mockRejectedValue(new AppError('Cannot complete job while a payment dispute is open.', 409, 'dispute_open'));
  mockQuery
    .mockResolvedValueOnce({ rows: [agreementRow()] })
    .mockResolvedValueOnce({ rows: [agreementRow({ status: 'completed', helper_completed_at: new Date(), customer_completed_at: new Date(), completed_at: new Date() })] })
    .mockResolvedValueOnce({ rows: [jobRow()] });

  const res = await request(buildApp(CUSTOMER_ID)).post(`/api/work-agreements/${AGREEMENT_ID}/complete`);

  expect(res.status).toBe(200);
  expect(res.body.awaitingCounterparty).toBe(false);
  expect(res.body.release).toEqual({ released: false, code: 'dispute_open' });
  expect(jobController.afterJobCompleted).not.toHaveBeenCalled();
});

test('no release attempt when the job is not completable', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [agreementRow()] })
    .mockResolvedValueOnce({ rows: [agreementRow({ status: 'completed', helper_completed_at: new Date(), customer_completed_at: new Date(), completed_at: new Date() })] })
    .mockResolvedValueOnce({ rows: [jobRow({ status: 'completed' })] });

  const res = await request(buildApp(CUSTOMER_ID)).post(`/api/work-agreements/${AGREEMENT_ID}/complete`);

  expect(res.status).toBe(200);
  expect(res.body.release).toEqual({ released: false, code: 'job_not_completable', job_status: 'completed' });
  expect(jobController.completeJobCore).not.toHaveBeenCalled();
});
