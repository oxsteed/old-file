'use strict';

/**
 * Agent job cancellation (POST /api/admin/jobs/:jobId/cancel).
 *
 * Covers the route/controller contract with the shared cancellation
 * transaction mocked out (its own suites cover the transaction semantics):
 *  - grant gating: 403 without the issue_refunds grant
 *  - reason required: 400 on empty reason
 *  - idempotent double-cancel: clean 200 alreadyCancelled, no re-apply
 *  - fail closed: transaction failure / invalid state surfaces an error and
 *    never a success payload
 *  - actor recorded as the admin; post-commit notifications fired
 */

const { mockQuery, resetMocks } = require('./setup');
const express = require('express');
const request = require('supertest');

const AppError = require('../utils/appError');

jest.mock('../middleware/adminAuth', () => {
  const actual = jest.requireActual('../middleware/adminAuth');
  return {
    ...actual,
    // Skip token/session auth: tests exercise grant gating, not session auth.
    requireAdmin: (req, _res, next) => {
      req.user = { id: 'admin-9' };
      req.isSuper = false;
      next();
    },
  };
});

const service = require('../services/jobCancellationService');
jest.mock('../services/jobCancellationService', () => ({
  cancelJobTransaction: jest.fn(),
  finalizeJobCancellation: jest.fn().mockResolvedValue(undefined),
}));

const agentJobActionsRoutes = require('../routes/agentJobActions');
const { errorHandler } = require('../middleware/errorHandler');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', agentJobActionsRoutes);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => errorHandler(err, _req, res, _req));
  return app;
}

// First query on every request is requirePermission('issue_refunds') against
// admin_permission_grants. Queue it before the controller's own queries.
function grantOk() {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, region_id: null, grant_source: 'direct' }] });
}
function grantDenied() {
  mockQuery.mockResolvedValueOnce({ rows: [] });
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('agent job cancellation', () => {
  test('rejects with 403 when the admin lacks the issue_refunds grant', async () => {
    grantDenied();

    const response = await request(buildApp())
      .post('/api/admin/jobs/123/cancel')
      .send({ reason: 'Duplicate job' });

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/issue_refunds/);
    // The grant lookup must be the exact scope, not some invented grant name.
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ['admin-9', 'issue_refunds']);
    expect(service.cancelJobTransaction).not.toHaveBeenCalled();
  });

  test('rejects with 400 when the reason is empty', async () => {
    for (const body of [{ reason: '' }, { reason: '   ' }, {}]) {
      grantOk();
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'accepted' }] }); // fast-path check
      const response = await request(buildApp())
        .post('/api/admin/jobs/123/cancel')
        .send(body);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('reason_required');
    }
    expect(service.cancelJobTransaction).not.toHaveBeenCalled();
  });

  test('cancelling an already-cancelled job is a clean non-error (no double-apply)', async () => {
    grantOk();
    mockQuery.mockResolvedValueOnce({ rows: [{ status: 'cancelled' }] }); // fast-path check

    const response = await request(buildApp())
      .post('/api/admin/jobs/123/cancel')
      .send({ reason: 'Second attempt' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.alreadyCancelled).toBe(true);
    expect(response.body.data.status).toBe('cancelled');
    // The transaction must never run for an already-cancelled job.
    expect(service.cancelJobTransaction).not.toHaveBeenCalled();
    expect(service.finalizeJobCancellation).not.toHaveBeenCalled();
  });

  test('records the admin as actor and fires post-commit notifications on success', async () => {
    grantOk();
    mockQuery.mockResolvedValueOnce({ rows: [{ status: 'accepted' }] }); // fast-path check
    service.cancelJobTransaction.mockResolvedValueOnce({
      type: 'post_acceptance',
      before_status: 'accepted',
      job_id: '123',
      cancelled_at: new Date('2026-10-03T00:00:00Z'),
      cancelled_by: 'admin',
      fee_charged_cents: 0,
      fee_to_helper_cents: 0,
      fee_to_platform_cents: 0,
      payment_method: 'oxsteed',
      helper_id: 'helper-1',
      customer_id: 'customer-1',
      audit_log_id: 7,
      fee_record_id: null,
    });

    const response = await request(buildApp())
      .post('/api/admin/jobs/123/cancel')
      .send({ reason: 'Fraudulent job' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.alreadyCancelled).toBe(false);
    expect(response.body.data.status).toBe('cancelled');
    expect(response.body.data.cancelled_by).toBe('admin');
    expect(response.body.data.before_status).toBe('accepted');

    expect(service.cancelJobTransaction).toHaveBeenCalledWith({
      jobId: '123',
      actorId: 'admin-9',
      actorKind: 'admin',
      reason: 'Fraudulent job',
    });
    expect(service.finalizeJobCancellation).toHaveBeenCalledTimes(1);
  });

  test('fail closed: invalid state surfaces the error, never a success payload', async () => {
    grantOk();
    mockQuery.mockResolvedValueOnce({ rows: [{ status: 'completed' }] }); // fast-path check
    service.cancelJobTransaction.mockRejectedValueOnce(
      new AppError('Job cannot be cancelled in current state', 409)
    );
    mockQuery.mockResolvedValueOnce({ rows: [{ status: 'completed' }] }); // race re-check

    const response = await request(buildApp())
      .post('/api/admin/jobs/123/cancel')
      .send({ reason: 'Too late' });

    expect(response.status).toBe(409);
    expect(response.body.success).not.toBe(true);
    expect(service.finalizeJobCancellation).not.toHaveBeenCalled();
  });

  test('fail closed: unexpected transaction failure returns 500, not success', async () => {
    grantOk();
    mockQuery.mockResolvedValueOnce({ rows: [{ status: 'in_progress' }] }); // fast-path check
    service.cancelJobTransaction.mockRejectedValueOnce(new Error('db exploded'));

    const response = await request(buildApp())
      .post('/api/admin/jobs/123/cancel')
      .send({ reason: 'Testing failure path' });

    expect(response.status).toBe(500);
    expect(response.body.success).not.toBe(true);
    expect(service.finalizeJobCancellation).not.toHaveBeenCalled();
  });

  test('race-safe idempotency: concurrent cancel that won the row returns alreadyCancelled', async () => {
    grantOk();
    mockQuery.mockResolvedValueOnce({ rows: [{ status: 'accepted' }] }); // fast-path check
    service.cancelJobTransaction.mockRejectedValueOnce(
      new AppError('Job state changed during cancellation', 409, 'state_conflict')
    );
    mockQuery.mockResolvedValueOnce({ rows: [{ status: 'cancelled' }] }); // race re-check: won

    const response = await request(buildApp())
      .post('/api/admin/jobs/123/cancel')
      .send({ reason: 'Racing cancel' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.alreadyCancelled).toBe(true);
    expect(service.finalizeJobCancellation).not.toHaveBeenCalled();
  });

  test('404 when the job does not exist', async () => {
    grantOk();
    mockQuery.mockResolvedValueOnce({ rows: [] }); // fast-path check

    const response = await request(buildApp())
      .post('/api/admin/jobs/999/cancel')
      .send({ reason: 'Ghost job' });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('job_not_found');
    expect(service.cancelJobTransaction).not.toHaveBeenCalled();
  });
});
