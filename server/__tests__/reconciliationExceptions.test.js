'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const { generateTokens } = require('../middleware/auth');

const reconciliationRoutes = require('../routes/reconciliation');
const { recordException } = require('../services/reconciliationExceptions');

const ADMIN_ID = '00000000-0000-4000-8000-000000000991';
const EXCEPTION_ID = '11111111-1111-4000-8000-000000000111';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/reconciliation', reconciliationRoutes);
  app.use(errorHandler);
  return app;
}

function adminAuthHeader() {
  const { accessToken } = generateTokens({
    id: ADMIN_ID,
    email: 'admin@example.com',
    role: 'super_admin',
  });
  return `Bearer ${accessToken}`;
}

function adminUserRow() {
  return { rows: [{ id: ADMIN_ID, role: 'super_admin', is_active: true, totp_enabled: true }] };
}

function openExceptionRow(overrides = {}) {
  return {
    id: EXCEPTION_ID,
    domain: 'payment_refund',
    reference_id: 'refund-123',
    severity: 'warning',
    status: 'open',
    owner_admin_id: null,
    summary: 'Payment refund reconciliation attempt failed',
    details: { error: 'boom', attempts: 1 },
    source_run_id: 'payment-refund-reconciliation',
    created_at: '2026-09-29T00:00:00.000Z',
    updated_at: '2026-09-29T00:00:00.000Z',
    resolved_at: null,
    ...overrides,
  };
}

beforeEach(() => resetMocks());

describe('reconciliation routes', () => {
  test('list applies filters, pagination, and returns workspace counts', async () => {
    const exception = openExceptionRow();
    mockQuery
      .mockResolvedValueOnce(adminUserRow())
      .mockResolvedValueOnce({ rows: [{ total: 2 }] })
      .mockResolvedValueOnce({ rows: [exception] })
      .mockResolvedValueOnce({ rows: [{ total: 3 }] }) // stuck refunds table 1
      .mockResolvedValueOnce({ rows: [{ total: 1 }] }) // stuck refunds table 2
      .mockResolvedValueOnce({ rows: [{ total: 0 }] }) // stuck refunds table 3
      .mockResolvedValueOnce({ rows: [{ total: 1 }] }) // failed credit runs 7d
      .mockResolvedValueOnce({ rows: [{ total: 4 }] }); // unsettled payouts 48h

    const res = await request(buildApp())
      .get('/api/admin/reconciliation?domain=payment_refund&status=open&severity=warning&page=2&limit=10')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ id: EXCEPTION_ID, domain: 'payment_refund' });
    expect(res.body.pagination).toMatchObject({ page: 2, limit: 10, total: 2 });
    expect(res.body.counts).toEqual({
      stuck_refund_attempts: 4,
      failed_credit_runs_7d: 1,
      unsettled_payouts_48h: 4,
    });

    const totalQuery = mockQuery.mock.calls[1][0];
    expect(totalQuery).toContain('domain = $1');
    expect(totalQuery).toContain('status = $2');
    expect(totalQuery).toContain('severity = $3');
  });

  test('list rejects invalid filter values', async () => {
    mockQuery.mockResolvedValueOnce(adminUserRow());

    const res = await request(buildApp())
      .get('/api/admin/reconciliation?status=bogus')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid status filter.');
  });

  test('list degrades counts to 0 when count tables are missing', async () => {
    const exception = openExceptionRow();
    mockQuery
      .mockResolvedValueOnce(adminUserRow())
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [exception] })
      .mockRejectedValueOnce(new Error('relation "payment_refund_attempts" does not exist'))
      .mockRejectedValueOnce(new Error('relation "marketplace_transaction_refunds" does not exist'))
      .mockRejectedValueOnce(new Error('relation "external_refund_attempts" does not exist'))
      .mockRejectedValueOnce(new Error('relation "oxsteed_credit_reconciliation_runs" does not exist'))
      .mockRejectedValueOnce(new Error('relation "payout_transactions" does not exist'));

    const res = await request(buildApp())
      .get('/api/admin/reconciliation')
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({
      stuck_refund_attempts: 0,
      failed_credit_runs_7d: 0,
      unsettled_payouts_48h: 0,
    });
  });

  test('assign sets owner_admin_id and records the audit action', async () => {
    const before = openExceptionRow();
    const after = openExceptionRow({ owner_admin_id: ADMIN_ID });
    mockQuery
      .mockResolvedValueOnce(adminUserRow())
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [before] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [after] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }) // audit INSERT
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const res = await request(buildApp())
      .post(`/api/admin/reconciliation/exceptions/${EXCEPTION_ID}/assign`)
      .set('Authorization', adminAuthHeader())
      .send({ admin_id: ADMIN_ID });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: EXCEPTION_ID, owner_admin_id: ADMIN_ID });

    const updateCall = mockQuery.mock.calls.find((call) => call[0].includes('UPDATE reconciliation_exceptions'));
    expect(updateCall[1]).toEqual([EXCEPTION_ID, ADMIN_ID]);

    const auditCall = mockQuery.mock.calls.find((call) => call[0].includes('admin_audit_log'));
    expect(auditCall).toBeTruthy();
    expect(auditCall[1][1]).toBe('reconciliation_exception_assigned');
  });

  test('assign rejects a missing admin_id', async () => {
    mockQuery.mockResolvedValueOnce(adminUserRow());

    const res = await request(buildApp())
      .post(`/api/admin/reconciliation/exceptions/${EXCEPTION_ID}/assign`)
      .set('Authorization', adminAuthHeader())
      .send({});

    expect(res.status).toBe(400);
  });

  test('acknowledge then resolve follows the forward-only path', async () => {
    const acknowledged = openExceptionRow({ status: 'acknowledged' });
    const resolved = openExceptionRow({ status: 'resolved', resolved_at: '2026-09-29T01:00:00.000Z' });

    // Acknowledge: open -> acknowledged
    mockQuery
      .mockResolvedValueOnce(adminUserRow())
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [openExceptionRow()] })
      .mockResolvedValueOnce({ rows: [acknowledged] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const ackRes = await request(buildApp())
      .post(`/api/admin/reconciliation/exceptions/${EXCEPTION_ID}/acknowledge`)
      .set('Authorization', adminAuthHeader());
    expect(ackRes.status).toBe(200);
    expect(ackRes.body.data).toMatchObject({ status: 'acknowledged' });
    expect(ackRes.body.data.resolved_at).toBeNull();

    // Resolve: acknowledged -> resolved
    resetMocks();
    mockQuery
      .mockResolvedValueOnce(adminUserRow())
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [acknowledged] })
      .mockResolvedValueOnce({ rows: [resolved] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const resRes = await request(buildApp())
      .post(`/api/admin/reconciliation/exceptions/${EXCEPTION_ID}/resolve`)
      .set('Authorization', adminAuthHeader());
    expect(resRes.status).toBe(200);
    expect(resRes.body.data).toMatchObject({ status: 'resolved' });
    expect(resRes.body.data.resolved_at).toBeTruthy();
  });

  test('backward transition resolved -> open is rejected with 409', async () => {
    const resolved = openExceptionRow({ status: 'resolved', resolved_at: '2026-09-29T01:00:00.000Z' });
    mockQuery
      .mockResolvedValueOnce(adminUserRow())
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [resolved] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const res = await request(buildApp())
      .post(`/api/admin/reconciliation/exceptions/${EXCEPTION_ID}/acknowledge`)
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('reconciliation_transition_invalid');
    expect(res.body.currentStatus).toBe('resolved');
  });

  test('transition on an unknown exception returns 404', async () => {
    mockQuery
      .mockResolvedValueOnce(adminUserRow())
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post(`/api/admin/reconciliation/exceptions/${EXCEPTION_ID}/resolve`)
      .set('Authorization', adminAuthHeader());

    expect(res.status).toBe(404);
  });
});

describe('recordException', () => {
  test('dedupes on the same domain + reference_id', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // first SELECT: no existing row -> insert
      .mockResolvedValueOnce({ rows: [{ id: EXCEPTION_ID }] }) // INSERT returning the new id
      .mockResolvedValueOnce({ rows: [{ id: EXCEPTION_ID }] }); // second SELECT: existing row -> dedupe

    const first = await recordException({
      domain: 'payment_refund',
      referenceId: 'refund-123',
      severity: 'warning',
      summary: 'Payment refund reconciliation attempt failed',
      details: { error: 'boom', attempts: 1 },
      sourceRunId: 'payment-refund-reconciliation',
    });
    expect(first).toBe(EXCEPTION_ID);

    const second = await recordException({
      domain: 'payment_refund',
      referenceId: 'refund-123',
      severity: 'critical',
      summary: 'Payment refund reconciliation attempt failed again',
    });
    expect(second).toBe(EXCEPTION_ID);

    const insertCalls = mockQuery.mock.calls.filter((call) =>
      call[0].includes('INSERT INTO reconciliation_exceptions')
    );
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0][1]).toEqual([
      'payment_refund',
      'refund-123',
      'warning',
      'Payment refund reconciliation attempt failed',
      JSON.stringify({ error: 'boom', attempts: 1 }),
      'payment-refund-reconciliation',
    ]);
  });

  test('never throws when the database is unavailable', async () => {
    mockQuery.mockRejectedValue(new Error('connection refused'));

    await expect(
      recordException({
        domain: 'external_refund',
        referenceId: 'ext-9',
        summary: 'External refund reconciliation attempt failed',
      })
    ).resolves.toBeNull();
  });

  test('rejects invalid domains without throwing', async () => {
    await expect(
      recordException({ domain: 'nope', referenceId: 'x', summary: 'y' })
    ).resolves.toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
