'use strict';

// Domain 7 #26 (repro-first): the admin reconciliation request carries
// periodStart/periodEnd, the server validates them, then ignores them — the
// run always covers the all-time ledger. The period fields must stop
// travelling from the client, and the server must stop accepting them from
// the request body. The nightly job still supplies its own run window
// internally (previous UTC day), so the service keeps an optional period
// for that caller and otherwise records a server-chosen run window.
const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/oxsteedCreditAdminService', () => {
  const actual = jest.requireActual('../services/oxsteedCreditAdminService');
  return { ...actual, reconcileCreditLedger: jest.fn() };
});
const { reconcileCreditLedger } = require('../services/oxsteedCreditAdminService');
const { errorHandler } = require('../middleware/errorHandler');
const oxsteedCreditCtrl = require('../controllers/oxsteedCreditController');

const { reconcileCreditLedger: realReconcile } = jest.requireActual('../services/oxsteedCreditAdminService');

function app(handler) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = { id: 'admin-1' }; req.correlationId = 'corr-1'; next(); });
  a.post('/reconciliation', handler);
  a.use(errorHandler);
  return a;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

test('controller drops client-supplied period fields instead of forwarding them', async () => {
  reconcileCreditLedger.mockResolvedValue({ run: { id: 'run-1', status: 'balanced', scope: 'all_time_ledger' } });
  const res = await request(app(oxsteedCreditCtrl.reconcileAdminCredit))
    .post('/reconciliation')
    .send({
      currencyCode: 'USD',
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-01-31T00:00:00.000Z',
      reason: 'Manual check',
    });
  expect(res.status).toBe(200);
  expect(reconcileCreditLedger).toHaveBeenCalledTimes(1);
  const args = reconcileCreditLedger.mock.calls[0][0];
  expect(args).not.toHaveProperty('periodStart');
  expect(args).not.toHaveProperty('periodEnd');
  expect(args).toMatchObject({ currencyCode: 'USD', reason: 'Manual check' });
});

test('service runs the all-time reconciliation with no caller period', async () => {
  // Same mocked query sequence as the existing balanced-run test:
  // derived totals, reservation scan, hash checks (2), run insert, audit.
  mockQuery
    .mockResolvedValueOnce({ rows: [{ account_balance_cents: '1000', journal_balance_cents: '1000', difference_cents: '0', account_count: 1, entry_count: 2 }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 'run-9', currency_code: 'USD', period_start: '2026-11-13T00:00:00.000Z', period_end: '2026-11-13T00:00:01.000Z', status: 'balanced', account_balance_cents: '1000', journal_balance_cents: '1000', difference_cents: '0', account_count: 1, entry_count: 2, completed_at: '2026-11-13T00:00:00.000Z' }] })
    .mockResolvedValueOnce({ rows: [] });

  const result = await realReconcile({ currencyCode: 'USD', actorUserId: null, correlationId: 'reconciliation-request-26' });

  expect(result.run).toMatchObject({ status: 'balanced', scope: 'all_time_ledger' });
  const insertCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO oxsteed_credit_reconciliation_runs'));
  expect(insertCall).toBeDefined();
  const [, params] = insertCall;
  expect(params[1]).toBeInstanceOf(Date);
  expect(params[2]).toBeInstanceOf(Date);
  expect(params[2].getTime()).toBeGreaterThan(params[1].getTime());
  const metadata = JSON.parse(params[11]);
  expect(metadata.scope).toBe('all_time_ledger');
  expect(metadata.requestedPeriodStart).toBe(params[1].toISOString());
  expect(metadata.requestedPeriodEnd).toBe(params[2].toISOString());
});
