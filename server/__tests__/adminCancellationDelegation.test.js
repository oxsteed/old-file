'use strict';

/**
 * RV1(b): admin force-cancel paths delegate to the shared cancellation service.
 *
 * - superAdminController.forceJobAction (cancel/remove) calls
 *   cancelJobTransaction({ jobId, actorId, actorKind: 'admin', reason }) and
 *   finalizeJobCancellation(result); it never issues its own status UPDATE.
 * - adminController.reviewReport with action=remove_content on a job target
 *   delegates to the same service (reason 'Removed by moderation'), commits
 *   the review, then runs post-commit finalization.
 * - Service failures fail closed: a 409 from the escrow/payment checks
 *   surfaces the AppError status instead of a success payload, and the
 *   moderation review rolls back (the report stays pending).
 */

const { mockQuery, resetMocks } = require('./setup');
const express = require('express');
const request = require('supertest');

const AppError = require('../utils/appError');

jest.mock('../middleware/adminAuth', () => ({
  requireAdmin: (req, _res, next) => { req.user = { id: 'admin-9' }; next(); },
  requirePermission: (_perm) => (_req, _res, next) => next(),
}));

const service = require('../services/jobCancellationService');
jest.mock('../services/jobCancellationService', () => ({
  cancelJobTransaction: jest.fn(),
  finalizeJobCancellation: jest.fn().mockResolvedValue(undefined),
}));

const superCtrl = require('../controllers/superAdminController');
const adminCtrl = require('../controllers/adminController');
const { errorHandler } = require('../middleware/errorHandler');

function buildApp() {
  const app = express();
  app.use(express.json());
  // The adminAuth mock covers route files; here the controllers are mounted
  // directly, so stamp the admin identity the middleware would provide.
  app.use('/admin', (req, _res, next) => { req.user = { id: 'admin-9' }; next(); });
  app.post('/admin/jobs/:jobId/action', superCtrl.forceJobAction);
  app.put('/admin/reports/:reportId', adminCtrl.reviewReport);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => errorHandler(err, _req, res, _req));
  return app;
}

const app = buildApp();

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  // Route every DB call by query text: schema probe answers truthy, job and
  // report lookups answer per-test fixtures, everything else is empty.
  mockQuery.mockImplementation(async (text) => {
    const t = String(text || '');
    if (t.includes('information_schema')) return { rows: [{ '?column?': 1 }], rowCount: 1 };
    if (t.includes('FROM jobs WHERE id')) return { rows: [{ id: 'job-1', status: 'published', metadata: {} }], rowCount: 1 };
    if (t.includes('FROM content_reports WHERE id')) {
      return {
        rows: [{
          id: 'rep-1', status: 'pending', target_type: 'job', target_id: 'job-1',
          reporter_id: 'user-1', action_taken: null,
        }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });
});

function rawJobStatusUpdates() {
  return mockQuery.mock.calls.filter(([text]) =>
    /UPDATE\s+jobs\s+SET\s+status\s*=\s*'cancelled'/i.test(String(text || ''))
  );
}

describe('forceJobAction cancel/remove delegation', () => {
  test('cancel delegates to the cancellation service as admin and finalizes', async () => {
    service.cancelJobTransaction.mockResolvedValue({
      type: 'pre_acceptance', before_status: 'published',
      job: { id: 'job-1' }, rejectedBids: [], cancelled_by: 'admin',
    });

    const res = await request(app)
      .post('/admin/jobs/job-1/action')
      .send({ action: 'cancel', reason: 'spam listing' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Job cancel successful.');
    expect(service.cancelJobTransaction).toHaveBeenCalledTimes(1);
    expect(service.cancelJobTransaction).toHaveBeenCalledWith({
      jobId: 'job-1', actorId: 'admin-9', actorKind: 'admin', reason: 'spam listing',
    });
    expect(service.finalizeJobCancellation).toHaveBeenCalledTimes(1);
    // No hand-rolled status flip: the service owns the UPDATE.
    expect(rawJobStatusUpdates()).toHaveLength(0);
  });

  test('remove delegates the same way', async () => {
    service.cancelJobTransaction.mockResolvedValue({
      type: 'pre_acceptance', before_status: 'published',
      job: { id: 'job-1' }, rejectedBids: [], cancelled_by: 'admin',
    });

    const res = await request(app)
      .post('/admin/jobs/job-1/action')
      .send({ action: 'remove', reason: 'policy violation' });

    expect(res.status).toBe(200);
    expect(service.cancelJobTransaction).toHaveBeenCalledWith({
      jobId: 'job-1', actorId: 'admin-9', actorKind: 'admin', reason: 'policy violation',
    });
    expect(service.finalizeJobCancellation).toHaveBeenCalledTimes(1);
    expect(rawJobStatusUpdates()).toHaveLength(0);
  });

  test('already-cancelled job is idempotent and never re-applies', async () => {
    mockQuery.mockImplementation(async (text) => {
      const t = String(text || '');
      if (t.includes('information_schema')) return { rows: [{ '?column?': 1 }], rowCount: 1 };
      if (t.includes('FROM jobs WHERE id')) return { rows: [{ id: 'job-1', status: 'cancelled', metadata: {} }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post('/admin/jobs/job-1/action')
      .send({ action: 'cancel', reason: 'dup' });

    expect(res.status).toBe(200);
    expect(res.body.alreadyCancelled).toBe(true);
    expect(service.cancelJobTransaction).not.toHaveBeenCalled();
    expect(rawJobStatusUpdates()).toHaveLength(0);
  });

  test('service 409 (pending escrow) surfaces instead of a success payload', async () => {
    service.cancelJobTransaction.mockRejectedValue(
      new AppError('Cannot cancel job with pending payments. Refund the payment first.', 409, 'pending_payments')
    );

    const res = await request(app)
      .post('/admin/jobs/job-1/action')
      .send({ action: 'cancel', reason: 'x' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('pending_payments');
    expect(service.finalizeJobCancellation).not.toHaveBeenCalled();
  });

  test('flag/unflag actions do not touch the cancellation service', async () => {
    mockQuery.mockImplementation(async (text) => {
      const t = String(text || '');
      if (t.includes('information_schema')) return { rows: [{ '?column?': 1 }], rowCount: 1 };
      if (t.includes('FROM jobs WHERE id')) return { rows: [{ id: 'job-1', status: 'published', metadata: {} }], rowCount: 1 };
      if (/UPDATE\s+jobs\s+SET\s+metadata/i.test(t)) return { rows: [{ id: 'job-1' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post('/admin/jobs/job-1/action')
      .send({ action: 'flag', reason: 'review' });

    expect(res.status).toBe(200);
    expect(service.cancelJobTransaction).not.toHaveBeenCalled();
    expect(service.finalizeJobCancellation).not.toHaveBeenCalled();
  });
});

describe('reviewReport remove_content delegation', () => {
  test('moderation job removal delegates with reason and finalizes after commit', async () => {
    const cancelResult = {
      type: 'pre_acceptance', before_status: 'published',
      job: { id: 'job-1' }, rejectedBids: [], cancelled_by: 'admin',
    };
    service.cancelJobTransaction.mockResolvedValue(cancelResult);

    const res = await request(app)
      .put('/admin/reports/rep-1')
      .send({ action: 'remove_content' });

    expect(res.status).toBe(200);
    expect(service.cancelJobTransaction).toHaveBeenCalledTimes(1);
    expect(service.cancelJobTransaction).toHaveBeenCalledWith({
      jobId: 'job-1', actorId: 'admin-9', actorKind: 'admin', reason: 'Removed by moderation',
    });
    expect(service.finalizeJobCancellation).toHaveBeenCalledWith(cancelResult);
    expect(rawJobStatusUpdates()).toHaveLength(0);
    // The report review itself still commits.
    const statements = mockQuery.mock.calls.map(([text]) => String(text || ''));
    expect(statements.some((s) => s === 'COMMIT')).toBe(true);
  });

  test('service failure rolls the review back and surfaces the AppError', async () => {
    service.cancelJobTransaction.mockRejectedValue(
      new AppError('Cannot cancel job with pending payments. Refund the payment first.', 409, 'pending_payments')
    );

    const res = await request(app)
      .put('/admin/reports/rep-1')
      .send({ action: 'remove_content' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('pending_payments');
    const statements = mockQuery.mock.calls.map(([text]) => String(text || ''));
    expect(statements.some((s) => s === 'ROLLBACK')).toBe(true);
    expect(service.finalizeJobCancellation).not.toHaveBeenCalled();
  });

  test('dismiss does not touch the cancellation service', async () => {
    const res = await request(app)
      .put('/admin/reports/rep-1')
      .send({ action: 'dismiss' });

    expect(res.status).toBe(200);
    expect(service.cancelJobTransaction).not.toHaveBeenCalled();
    expect(service.finalizeJobCancellation).not.toHaveBeenCalled();
  });
});
