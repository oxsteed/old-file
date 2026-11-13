'use strict';

// Domain 7 #10: chargeback evidence submit has no limiter or impersonation
// rejection, and a double-submit race. submitEvidence did a plain SELECT
// for evidence_submitted_at, then pushed to Stripe and only afterwards
// stamped the row, with no FOR UPDATE lock and no conditional stamp, so
// two concurrent submits both pushed evidence to Stripe.
//
// This file covers the route guards and the sequential/404/failure
// behavior with a mocked DB. True concurrent serialization is proven
// against the real database in chargebackEvidenceSubmitRace.db.test.js:
// the shared jest setup mocks withTransaction without transaction
// boundaries, so a mocked row lock could never be released there.

const { mockQuery, resetMocks } = require('./setup');

const mockDisputesUpdate = jest.fn();
jest.mock('stripe', () => () => ({ disputes: { update: mockDisputesUpdate } }));
jest.mock('../services/reconciliationExceptions', () => ({ recordException: jest.fn().mockResolvedValue(1) }));
jest.mock('../jobs/jobLockingService', () => ({
  withFencedJobLock: async (_name, fn) => fn({ assertActive() {}, db: require('../db') }),
}));

const svc = require('../services/chargebackEvidenceService');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const { creditAdminMutationLimiter } = require('../middleware/rateLimiter');
const adminRouter = require('../routes/admin');

const paymentRow = {
  id: 3, job_id: 'j1', title: 'Fix sink', description: 'Leak', job_status: 'completed',
  completed_at: '2026-10-01T10:00:00Z', completion_confirmed_at: '2026-10-01T12:00:00Z',
  customer_email: 'c@x.com', customer_first: 'Ana', customer_last: 'Lee',
};

let fakeRow;

function routeDb() {
  mockQuery.mockImplementation(async (sql, params) => {
    const t = String(sql);
    // The shared jest setup mocks withTransaction without transaction
    // boundaries (no BEGIN/COMMIT), so row-lock serialization cannot be
    // modeled here: a SELECT ... FOR UPDATE just reads the current row.
    // True concurrent serialization is proven against the real database
    // in chargebackEvidenceSubmitRace.db.test.js instead.
    if (t === 'BEGIN' || t === 'COMMIT' || t === 'ROLLBACK') return { rows: [] };
    if (t.includes('SELECT * FROM stripe_chargebacks')) return { rows: [{ ...fakeRow }] };
    if (t.includes('FROM payments p')) return { rows: [{ ...paymentRow }] };
    if (t.includes('FROM work_agreements')) return { rows: [] };
    if (t.includes('UPDATE stripe_chargebacks')) {
      // pushEvidence's stamp: params[2] is the submit flag.
      if (params && params[2] === true) fakeRow.evidence_submitted_at = new Date().toISOString();
      return { rows: [{ ...fakeRow }] };
    }
    return { rows: [] };
  });
}

function routeHandlers(router, path) {
  const matches = [];
  for (const layer of router.stack || []) {
    if (!layer.route) continue;
    const routePath = layer.route.path;
    const paths = Array.isArray(routePath) ? routePath : [routePath];
    if (paths.includes(path)) {
      matches.push(...layer.route.stack.map((l) => l.handle));
    }
  }
  return matches;
}

beforeEach(() => {
  resetMocks();
  mockDisputesUpdate.mockReset().mockResolvedValue({ id: 'dp_1' });
  fakeRow = {
    id: 9, stripe_dispute_id: 'dp_1', stripe_status: 'needs_response',
    stripe_charge_id: 'ch_1', stripe_payment_intent_id: 'pi_1',
    evidence_submitted_at: null, evidence_staged_at: null,
  };
  routeDb();
});

describe('Domain 7 #10: submit route guards', () => {
  test('the submit route carries rejectImpersonated and creditAdminMutationLimiter', () => {
    const handlers = routeHandlers(adminRouter, '/super/chargebacks/:id/submit');
    expect(handlers.length).toBeGreaterThan(0);
    expect(handlers).toContain(rejectImpersonated);
    expect(handlers).toContain(creditAdminMutationLimiter);
  });
});

describe('Domain 7 #10: double-submit race', () => {
  // Concurrent double-submit is proven against the real database in
  // chargebackEvidenceSubmitRace.db.test.js: the shared jest setup mocks
  // withTransaction without transaction boundaries, so a mocked row lock
  // could never be released and the test would deadlock rather than
  // prove serialization.
  test('a sequential second submit is rejected 409 and does not push again', async () => {
    await svc.submitEvidence(9, { actorId: 'admin-1' });
    expect(mockDisputesUpdate).toHaveBeenCalledTimes(1);
    await expect(svc.submitEvidence(9, { actorId: 'admin-2' })).rejects.toMatchObject({ code: 'already_submitted', status: 409 });
    expect(mockDisputesUpdate).toHaveBeenCalledTimes(1);
  });

  test('a missing chargeback is 404', async () => {
    fakeRow = null;
    mockQuery.mockImplementation(async (sql) => {
      const t = String(sql);
      if (t === 'BEGIN' || t === 'COMMIT' || t === 'ROLLBACK') return { rows: [] };
      return { rows: [] };
    });
    await expect(svc.submitEvidence(999, { actorId: 'admin-1' })).rejects.toMatchObject({ code: 'not_found', status: 404 });
    expect(mockDisputesUpdate).not.toHaveBeenCalled();
  });

  test('a Stripe failure still records attempts/last_error even though the submit transaction rolls back', async () => {
    mockDisputesUpdate.mockRejectedValue(new Error('stripe down'));
    await expect(svc.submitEvidence(9, { actorId: 'admin-1' })).rejects.toMatchObject({ code: 'dispute_evidence_failed' });
    // One attempts bookkeeping write survives: the post-rollback catch-up
    // outside the transaction (the in-transaction write rolled back).
    const errorWrites = mockQuery.mock.calls.filter(([sql, params]) =>
      /last_error = \$2/.test(String(sql)) && params && params[1] === 'stripe down'
    );
    expect(errorWrites.length).toBeGreaterThanOrEqual(1);
    expect(fakeRow.evidence_submitted_at).toBeNull();
  });
});
