'use strict';

/**
 * Logistics refunds — release-blocker regression suite.
 *
 * Covers the three release blockers fixed alongside the dual-admin refund
 * flow (server/services/logisticsRefundService.js):
 *
 * Fix 1 — full refunds were impossible: remainingRefundableCents counted the
 *   case under evaluation against its own cap, so any refund over 50% of the
 *   paid amount (including a full refund) failed at approve/execute time.
 *   The case under evaluation is now excluded from its own cap computation
 *   while other active cases still encumber.
 * Fix 2 — expireStaleProposals was never scheduled: stale `proposed` cases
 *   encumbered balances forever. Now wired via
 *   server/jobs/logisticsRefundProposalExpiry.js (hourly).
 * Fix 3 — pending Stripe refunds never completed: the code notified
 *   `refund_processed` while Stripe still reported pending, and nothing ever
 *   moved `executing` -> `processed`. The signed webhook handler now routes
 *   charge.refunded / refund.updated through confirmStripeRefund; buyers get
 *   `refund_pending` while Stripe reports pending and `refund_processed`
 *   only on confirmation.
 *
 * Part 1 tests the service layer against an in-memory fake DB. Part 2 tests
 * the webhook confirmation path through the real handleStripeEvent with the
 * shared pg mock. Part 3 checks the expiry job wiring.
 */

const { mockQuery, resetMocks } = require('./setup');
const fakeDb = require('./helpers/logisticsPaymentFakeDb');

const mockSendNotification = jest.fn().mockResolvedValue({ id: 1 });
jest.mock('../services/notificationService', () => ({
  sendNotification: (...args) => mockSendNotification(...args),
}));

const svc = require('../services/logisticsRefundService');

// ─── Part 1: in-memory fake DB for the refund service ────────

function makeFakeDb() {
  const db = {
    cases: [],
    decisions: [],
    recon: [],
    sqlLog: [],
    nextId: 1,
  };

  function findCase(id) {
    return db.cases.find((c) => String(c.id) === String(id)) || null;
  }
  function findCaseByStripeRefundId(stripeRefundId) {
    return db.cases.find((c) => c.stripe_refund_id === stripeRefundId) || null;
  }

  async function query(sql, params = []) {
    const s = String(sql);
    db.sqlLog.push(s);
    if (/^\s*BEGIN/i.test(s)) return { rows: [] };
    if (/^\s*COMMIT/i.test(s)) return { rows: [] };
    if (/^\s*ROLLBACK/i.test(s)) return { rows: [] };

    if (s.includes('INSERT INTO logistics_refund_decisions')) {
      db.decisions.push({
        refund_case_id: params[0], actor_user_id: params[1], action: params[2],
        reason: params[3], fresh_auth_ref: params[4], metadata: params[5],
      });
      return { rows: [] };
    }
    if (s.includes('INSERT INTO logistics_refund_cases')) {
      const kase = {
        id: db.nextId++,
        reference: params[0],
        user_id: params[1],
        refund_reason: params[2],
        requested_amount_usd: params[3],
        amount_cents: params[4],
        refund_method: params[5],
        original_payment_attempt_id: params[6],
        status: 'proposed',
        proposed_by: params[7],
        notes: params[8],
        approved_by: null, approved_at: null, fresh_auth_at: null,
        rejection_reason: null, stripe_refund_id: null, processor_ref: null,
        processed_by: null, processed_at: null,
        created_at: new Date(), updated_at: new Date(),
      };
      db.cases.push(kase);
      return { rows: [{ ...kase }] };
    }
    if (s.includes('INSERT INTO logistics_reconciliation_queue')) {
      db.recon.push({ source: 'logistics_refund', entity_id: params[0], reason: params[1], payload: params[2], status: 'pending' });
      return { rows: [] };
    }
    if (s.includes('COALESCE(SUM(amount_cents)')) {
      const attemptId = String(params[0]);
      const statuses = params[1];
      const excludeCaseId = params[2] != null ? String(params[2]) : null;
      const used = db.cases
        .filter((c) => String(c.original_payment_attempt_id) === attemptId
          && statuses.includes(c.status)
          && c.amount_cents != null
          && (excludeCaseId === null || String(c.id) !== excludeCaseId))
        .reduce((n, c) => n + c.amount_cents, 0);
      return { rows: [{ used }] };
    }
    // Propose path: row lock on the payment attempt serializes the
    // check+insert against concurrent proposals on the same attempt.
    if (/FROM logistics_payment_attempts WHERE id::text = \$1 FOR UPDATE/i.test(s)) {
      return { rows: [{ id: params[0] }] };
    }
    // Confirmation path: match our case by the Stripe refund id.
    if (/FROM logistics_refund_cases WHERE stripe_refund_id = \$1 FOR UPDATE/i.test(s)) {
      const kase = findCaseByStripeRefundId(params[0]);
      return { rows: kase ? [{ ...kase }] : [] };
    }
    if (s.includes('FOR UPDATE')) {
      const kase = findCase(params[0]);
      return { rows: kase ? [{ ...kase }] : [] };
    }
    if (/SET status = 'approved'/.test(s)) {
      const kase = findCase(params[0]);
      kase.status = 'approved';
      kase.approved_by = params[1];
      kase.approved_at = new Date();
      kase.fresh_auth_at = params[2];
      if (params[3]) kase.notes = (kase.notes || '') + params[3];
      return { rows: [{ ...kase }] };
    }
    if (/SET status = 'executing'/.test(s)) {
      const kase = findCase(params[0]);
      kase.status = 'executing';
      return { rows: [] };
    }
    if (/SET status = 'failed'/.test(s)) {
      const kase = findCase(params[0]);
      kase.status = 'failed';
      return { rows: [] };
    }
    // Pending branch of execute: record the Stripe refund id on the case.
    if (/SET stripe_refund_id = \$2/.test(s)) {
      const kase = findCase(params[0]);
      kase.stripe_refund_id = params[1];
      kase.updated_at = new Date();
      return { rows: [{ ...kase }] };
    }
    if (/SET status = 'processed'/.test(s)) {
      const kase = findCase(params[0]);
      kase.status = 'processed';
      if (s.includes('stripe_refund_id')) kase.stripe_refund_id = params[1];
      if (s.includes('processor_ref')) kase.processor_ref = params[1];
      if (s.includes('processed_by')) kase.processed_by = params[2];
      kase.processed_at = new Date();
      return { rows: [{ ...kase }] };
    }
    if (/SET status = 'expired'/.test(s)) {
      const hours = parseFloat(params[0]);
      const cutoff = Date.now() - hours * 3600 * 1000;
      const expired = db.cases.filter((c) => c.status === 'proposed' && c.created_at.getTime() < cutoff);
      expired.forEach((c) => { c.status = 'expired'; });
      return { rows: expired.map((c) => ({ id: c.id, user_id: c.user_id, reference: c.reference, amount_cents: c.amount_cents })) };
    }
    if (/SELECT \* FROM logistics_refund_cases WHERE id = \$1/.test(s)) {
      const kase = findCase(params[0]);
      return { rows: kase ? [{ ...kase }] : [] };
    }
    throw new Error(`releaseFixes fakeDb: unhandled SQL: ${s.slice(0, 140)}`);
  }

  return { db, query };
}

function makePorts(overrides = {}) {
  const calls = { notify: [], stripeRefunds: [], creditReversals: [] };
  const attempt = {
    id: 'attempt-1',
    buyerUserId: 'buyer-1',
    amountCents: 10000, // $100.00 paid
    currency: 'USD',
    method: 'stripe',
    status: 'succeeded',
    paymentIntentId: 'pi_1',
    chargeId: 'ch_1',
  };
  const ports = {
    query: null,
    paymentPort: {
      getPaymentAttempt: jest.fn(async (_q, id) => (id === 'attempt-1' ? { ...attempt, ...(overrides.attempt || {}) } : null)),
    },
    disputePort: {
      checkDispute: jest.fn(async () => overrides.dispute || { known: true, open: false }),
    },
    stripePort: {
      createRefund: jest.fn(async (args) => {
        calls.stripeRefunds.push(args);
        if (overrides.stripeError) throw overrides.stripeError;
        return overrides.stripeResult || { id: 're_1', status: 'succeeded' };
      }),
    },
    creditPort: {
      reverseCredit: jest.fn(async (args) => {
        calls.creditReversals.push(args);
        const err = new Error('Credit reversal is not implemented yet (Credit workstream). Refund blocked.');
        err.code = 'credit_reversal_unavailable';
        err.statusCode = 503;
        throw err;
      }),
    },
    userPort: {
      getAdminUser: jest.fn(async (_q, userId) => overrides.approver || { id: userId, role: 'admin', isBanned: false }),
    },
    notifyPort: {
      notify: jest.fn(async (event, userId, vars) => { calls.notify.push({ event, userId, vars }); }),
    },
    calls,
  };
  return ports;
}

function bindDb(ports, query) {
  ports.query = query;
  ports.withTransaction = async (work) => work(query);
  return ports;
}

function freshAuth(minutesAgo = 2) {
  return {
    completedAt: new Date(Date.now() - minutesAgo * 60 * 1000),
    authHash: 'hash-abc',
    method: 'totp',
  };
}

async function proposeOk(ports, overrides = {}) {
  return svc.proposeRefund(ports, {
    proposerUserId: 'admin-1',
    paymentAttemptId: 'attempt-1',
    amountCents: 4000,
    reason: 'Buyer cancelled before shipment',
    refundMethod: 'stripe',
    ...overrides,
  });
}

async function approveOk(ports, caseId, approverUserId = 'admin-2') {
  return svc.approveRefund(ports, { caseId, approverUserId, freshAuthEvent: freshAuth() });
}

const notifyEvents = (ports) => ports.calls.notify.map((n) => n.event);

// ─── Fix 1: full refunds are possible ────────────────────────

describe('Fix 1 — full refunds are possible (self-cap exclusion)', () => {
  test('a full refund of a fully-paid order succeeds end to end', async () => {
    const { query } = makeFakeDb();
    const ports = bindDb(makePorts(), query);

    const proposed = await proposeOk(ports, { amountCents: 10000 });
    expect(proposed.status).toBe('proposed');

    // Pre-fix this 409ed: the case counted its own 10000c against the cap.
    const approved = await approveOk(ports, proposed.id);
    expect(approved.status).toBe('approved');

    const { case: kase, failed } = await svc.executeRefund(ports, { caseId: proposed.id, actorUserId: 'admin-3' });
    expect(failed).toBeFalsy();
    expect(kase.status).toBe('processed');
    expect(kase.stripe_refund_id).toBe('re_1');
    expect(ports.calls.stripeRefunds[0]).toMatchObject({ amountCents: 10000 });
    expect(notifyEvents(ports)).toEqual(
      expect.arrayContaining(['refund_proposed', 'refund_approved', 'refund_processed'])
    );
  });

  test('approve-time cap excludes the case itself while other proposals still encumber', async () => {
    const { query } = makeFakeDb();
    const ports = bindDb(makePorts(), query);

    const c60 = await proposeOk(ports, { amountCents: 6000, proposerUserId: 'admin-1' });
    const c40 = await proposeOk(ports, { amountCents: 4000, proposerUserId: 'admin-2' });

    // Pre-fix: approving the 6000c case computed remaining = 10000 - 10000 = 0 -> 409.
    await expect(approveOk(ports, c60.id, 'admin-3')).resolves.toMatchObject({ status: 'approved' });
    // The 4000c case must still fit around the 6000c encumbrance (remaining = 4000).
    await expect(approveOk(ports, c40.id, 'admin-3')).resolves.toMatchObject({ status: 'approved' });

    const { case: kase } = await svc.executeRefund(ports, { caseId: c60.id, actorUserId: 'admin-4' });
    expect(kase.status).toBe('processed');
  });

  test('the cap is still enforced when the balance is genuinely consumed', async () => {
    const { query } = makeFakeDb();
    const ports = bindDb(makePorts(), query);

    const full = await proposeOk(ports, { amountCents: 10000 });
    await approveOk(ports, full.id);
    const { case: done } = await svc.executeRefund(ports, { caseId: full.id, actorUserId: 'admin-3' });
    expect(done.status).toBe('processed');

    await expect(proposeOk(ports, { amountCents: 1, proposerUserId: 'admin-5' }))
      .rejects.toMatchObject({ code: 'refund_amount_exceeds_remaining' });
  });

  test('propose locks the payment attempt row before the cap check and insert', async () => {
    const { query, db } = makeFakeDb();
    const ports = bindDb(makePorts(), query);
    await proposeOk(ports);
    const lockIdx = db.sqlLog.findIndex(
      (s) => s.includes('logistics_payment_attempts') && /FOR UPDATE/i.test(s)
    );
    const insertIdx = db.sqlLog.findIndex((s) => s.includes('INSERT INTO logistics_refund_cases'));
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeGreaterThan(lockIdx);
  });
});

describe('Fix 1 — encumbrance accounting still enforced', () => {
  test('two proposals cannot over-encumber beyond the paid amount', async () => {
    const { query } = makeFakeDb();
    const ports = bindDb(makePorts(), query);

    await proposeOk(ports, { amountCents: 7000, proposerUserId: 'admin-1' });
    // Only 3000c remains encumbered-free.
    await expect(proposeOk(ports, { amountCents: 4000, proposerUserId: 'admin-2' }))
      .rejects.toMatchObject({ code: 'refund_amount_exceeds_remaining' });
    const c2 = await proposeOk(ports, { amountCents: 3000, proposerUserId: 'admin-2' });
    expect(c2.status).toBe('proposed');
  });
});

describe('dual-admin rule unchanged', () => {
  test('self-approval is still rejected with 403', async () => {
    const { query } = makeFakeDb();
    const ports = bindDb(makePorts(), query);
    const kase = await proposeOk(ports); // proposed by admin-1
    await expect(svc.approveRefund(ports, {
      caseId: kase.id, approverUserId: 'admin-1', freshAuthEvent: freshAuth(),
    })).rejects.toMatchObject({ statusCode: 403, code: 'refund_self_approval_forbidden' });
  });
});

// ─── Fix 3: pending -> processed confirmation ────────────────

describe('Fix 3 — pending Stripe refunds complete via confirmation', () => {
  async function pendingCase(ports, overrides = {}) {
    const proposed = await proposeOk(ports, overrides);
    const approved = await approveOk(ports, proposed.id);
    const out = await svc.executeRefund(ports, { caseId: approved.id, actorUserId: 'admin-3' });
    return { proposed, approved, ...out };
  }

  test('execute notifies refund_pending (not refund_processed) while Stripe reports pending', async () => {
    const { query, db } = makeFakeDb();
    const ports = bindDb(makePorts({ stripeResult: { id: 're_pend_1', status: 'pending' } }), query);

    const { case: kase, inProgress } = await pendingCase(ports);
    expect(inProgress).toBe(true);
    expect(kase.status).toBe('executing');
    expect(kase.stripe_refund_id).toBe('re_pend_1'); // recorded for webhook matching
    expect(notifyEvents(ports)).toContain('refund_pending');
    expect(notifyEvents(ports)).not.toContain('refund_processed');
    expect(db.recon).toHaveLength(1);
    expect(db.recon[0].reason).toBe('Stripe refund pending confirmation');
  });

  test('confirmStripeRefund moves executing -> processed on Stripe confirmation', async () => {
    const { query, db } = makeFakeDb();
    const ports = bindDb(makePorts({ stripeResult: { id: 're_pend_1', status: 'pending' } }), query);
    await pendingCase(ports);

    const result = await svc.confirmStripeRefund(ports, {
      stripeRefundId: 're_pend_1', status: 'succeeded', stripeEventId: 'evt_1',
    });
    expect(result).toMatchObject({ matched: true, outcome: 'confirmed' });
    expect(db.cases[0].status).toBe('processed');
    expect(notifyEvents(ports)).toContain('refund_processed');
    expect(db.decisions.some((d) => d.action === 'confirm_processed')).toBe(true);
  });

  test('confirmation is idempotent: a replay is a no-op', async () => {
    const { query, db } = makeFakeDb();
    const ports = bindDb(makePorts({ stripeResult: { id: 're_pend_1', status: 'pending' } }), query);
    await pendingCase(ports);

    const first = await svc.confirmStripeRefund(ports, { stripeRefundId: 're_pend_1', status: 'succeeded' });
    expect(first.outcome).toBe('confirmed');
    const second = await svc.confirmStripeRefund(ports, { stripeRefundId: 're_pend_1', status: 'succeeded' });
    expect(second).toMatchObject({ matched: true, outcome: 'already_processed' });

    expect(notifyEvents(ports).filter((e) => e === 'refund_processed')).toHaveLength(1);
    expect(db.decisions.filter((d) => d.action === 'confirm_processed')).toHaveLength(1);
  });

  test('unknown refund ids do not match any case', async () => {
    const { query, db } = makeFakeDb();
    const ports = bindDb(makePorts({ stripeResult: { id: 're_pend_1', status: 'pending' } }), query);
    await pendingCase(ports);

    const result = await svc.confirmStripeRefund(ports, { stripeRefundId: 're_unknown', status: 'succeeded' });
    expect(result).toEqual({ matched: false });
    expect(db.cases[0].status).toBe('executing');
    expect(notifyEvents(ports)).not.toContain('refund_processed');
  });

  test('a still-pending report keeps the case executing without re-notifying', async () => {
    const { query, db } = makeFakeDb();
    const ports = bindDb(makePorts({ stripeResult: { id: 're_pend_1', status: 'pending' } }), query);
    await pendingCase(ports);
    const pendingNotifies = notifyEvents(ports).filter((e) => e === 'refund_pending').length;

    const result = await svc.confirmStripeRefund(ports, { stripeRefundId: 're_pend_1', status: 'pending' });
    expect(result).toMatchObject({ matched: true, outcome: 'still_pending' });
    expect(db.cases[0].status).toBe('executing');
    expect(notifyEvents(ports).filter((e) => e === 'refund_pending')).toHaveLength(pendingNotifies);
    expect(notifyEvents(ports)).not.toContain('refund_processed');
    expect(db.decisions.some((d) => d.action === 'confirm_still_pending')).toBe(true);
  });

  test('a failed report marks the case failed and queues reconciliation', async () => {
    const { query, db } = makeFakeDb();
    const ports = bindDb(makePorts({ stripeResult: { id: 're_pend_1', status: 'pending' } }), query);
    await pendingCase(ports);

    const result = await svc.confirmStripeRefund(ports, { stripeRefundId: 're_pend_1', status: 'failed' });
    expect(result).toMatchObject({ matched: true, outcome: 'marked_failed' });
    expect(db.cases[0].status).toBe('failed');
    expect(db.recon.some((r) => r.reason.includes('failed'))).toBe(true);
    expect(notifyEvents(ports)).toContain('refund_failed');
    expect(notifyEvents(ports)).not.toContain('refund_processed');
  });

  test('confirmation on a non-executing case records unexpected_state for staff', async () => {
    const { query, db } = makeFakeDb();
    const ports = bindDb(makePorts({ stripeResult: { id: 're_pend_1', status: 'pending' } }), query);
    const { proposed } = await pendingCase(ports);
    // Simulate the case having left `executing` through another path.
    db.cases.find((c) => c.id === proposed.id).status = 'approved';

    const result = await svc.confirmStripeRefund(ports, { stripeRefundId: 're_pend_1', status: 'succeeded' });
    expect(result).toMatchObject({ matched: true, outcome: 'unexpected_state' });
    expect(db.cases[0].status).toBe('approved'); // untouched; staff decide
    expect(db.decisions.some((d) => d.action === 'confirm_unexpected_state')).toBe(true);
  });
});

describe('coordination — credit reversal runs on the executor transaction', () => {
  test('credit execution passes the tx client to the reversal (no nested transaction)', async () => {
    const { query, db } = makeFakeDb();
    const ports = bindDb(makePorts({ attempt: { method: 'credit' } }), query);
    ports.creditPort.reverseCredit = jest.fn(async (args) => {
      // The client must run on the executor's transaction: it observes the
      // case row the executor locked and already moved to `executing`.
      const { rows } = await args.client.query(
        `SELECT * FROM logistics_refund_cases WHERE id = $1`, [args.refundCaseId]
      );
      expect(rows[0].status).toBe('executing');
      return { ledgerEntryId: 'ledger-1' };
    });

    const proposed = await proposeOk(ports, { refundMethod: 'credit' });
    const approved = await approveOk(ports, proposed.id);
    const { case: kase, failed } = await svc.executeRefund(ports, { caseId: approved.id, actorUserId: 'admin-3' });

    expect(failed).toBeFalsy();
    expect(kase.status).toBe('processed');
    expect(kase.processor_ref).toBe('ledger-1');
    expect(ports.creditPort.reverseCredit).toHaveBeenCalledTimes(1);
    const args = ports.creditPort.reverseCredit.mock.calls[0][0];
    expect(args).toMatchObject({
      refundCaseId: approved.id,
      amountCents: 4000,
      currency: 'USD',
      idempotencyKey: svc.executionIdempotencyKey(approved.id),
    });
    expect(args.client).toBeDefined();
    expect(typeof args.client.query).toBe('function');
    expect(db.decisions.some((d) => d.action === 'execute')).toBe(true);
  });
});

// ─── Fix 2: expiry releases encumbrance; job is wired ────────

describe('Fix 2 — stale proposals expire and release encumbrance', () => {
  test('expiring a proposal frees its encumbrance for later refunds', async () => {
    const { query, db } = makeFakeDb();
    const ports = bindDb(makePorts(), query);

    const full = await proposeOk(ports, { amountCents: 10000 });
    // The full balance is encumbered while the proposal is active.
    await expect(proposeOk(ports, { amountCents: 1, proposerUserId: 'admin-2' }))
      .rejects.toMatchObject({ code: 'refund_amount_exceeds_remaining' });

    db.cases.find((c) => c.id === full.id).created_at = new Date(Date.now() - 80 * 3600 * 1000);
    const { expired } = await svc.expireStaleProposals(ports, { olderThanHours: 72 });
    expect(expired).toBe(1);
    expect(db.cases.find((c) => c.id === full.id).status).toBe('expired');

    // Encumbrance released: a fresh full-amount proposal now fits.
    const again = await proposeOk(ports, { amountCents: 10000, proposerUserId: 'admin-2' });
    expect(again.status).toBe('proposed');
  });

  test('the expiry job module exposes a valid schedule', () => {
    const cron = require('node-cron');
    const job = require('../jobs/logisticsRefundProposalExpiry');
    expect(job.JOB_NAME).toBe('logistics-refund-proposal-expiry');
    expect(cron.validate(job.CRON_EXPRESSION)).toBe(true);
    expect(job.CRON_TIMEZONE).toBe('UTC');
    expect(job.PROPOSAL_TTL_HOURS).toBe(72);
    expect(typeof job.startLogisticsRefundProposalExpiryJob).toBe('function');
    expect(typeof job.runLogisticsRefundProposalExpiry).toBe('function');
  });
});

// ─── Part 2: webhook confirmation through handleStripeEvent ──

describe('Fix 3 — webhook confirmation end to end (handleStripeEvent)', () => {
  const paymentsService = require('../services/logisticsPaymentService');
  let store;

  beforeEach(() => {
    resetMocks();
    mockSendNotification.mockClear();
    store = fakeDb.createStore();
    fakeDb.installRoutes(mockQuery, store);
  });

  function seedPendingRefundFlow(overrides = {}) {
    const attempt = fakeDb.seedAttempt(store, {
      buyer_user_id: 'buyer-1',
      amount_cents: 10000,
      method: 'stripe',
      status: 'succeeded',
      stripe_payment_intent_id: 'pi_test_1',
      ...overrides.attempt,
    });
    const kase = fakeDb.seedRefundCase(store, {
      user_id: 'buyer-1',
      amount_cents: 10000,
      status: 'executing',
      stripe_refund_id: 're_pend_1',
      original_payment_attempt_id: String(attempt.id),
      ...overrides.refundCase,
    });
    return { attempt, kase };
  }

  test('refund.updated confirms a pending case to processed (fallback attempt resolution)', async () => {
    seedPendingRefundFlow();
    // No payment_intent on the refund object: the handler must resolve the
    // attempt through our refund case instead of the payment-intent link.
    const result = await paymentsService.handleStripeEvent({
      id: 'evt_ru_1',
      type: 'refund.updated',
      data: {
        object: {
          id: 're_pend_1',
          object: 'refund',
          status: 'succeeded',
          metadata: { refund_case_id: '1' },
        },
      },
    });

    expect(result).toMatchObject({ handled: true, outcome: 'refund_confirmed' });
    expect(store.refundCases[0].status).toBe('processed');
    expect(store.refundDecisions.some((d) => d.action === 'confirm_processed')).toBe(true);
    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    expect(mockSendNotification.mock.calls[0][0]).toMatchObject({
      userId: 'buyer-1',
      type: 'logistics:refund_processed',
    });
  });

  test('a duplicate confirmation webhook is skipped before any state change', async () => {
    seedPendingRefundFlow();
    const event = {
      id: 'evt_ru_dup',
      type: 'refund.updated',
      data: { object: { id: 're_pend_1', object: 'refund', status: 'succeeded' } },
    };
    const first = await paymentsService.handleStripeEvent(event);
    expect(first.outcome).toBe('refund_confirmed');

    const second = await paymentsService.handleStripeEvent(event);
    expect(second).toMatchObject({ handled: true, duplicate: true });

    expect(store.refundCases[0].status).toBe('processed');
    expect(store.refundDecisions.filter((d) => d.action === 'confirm_processed')).toHaveLength(1);
    expect(mockSendNotification).toHaveBeenCalledTimes(1); // no second buyer ping
  });

  test('charge.refunded carrying our refund confirms it; the attempt is untouched', async () => {
    const { attempt } = seedPendingRefundFlow({
      refundCase: { stripe_refund_id: 're_pend_2' },
    });
    const result = await paymentsService.handleStripeEvent({
      id: 'evt_cr_2',
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_1',
          payment_intent: attempt.stripe_payment_intent_id,
          amount_refunded: 10000,
          currency: 'usd',
          refunds: { data: [{ id: 're_pend_2', status: 'succeeded', metadata: {} }] },
        },
      },
    });

    expect(result).toMatchObject({ handled: true, outcome: 'refund_confirmed' });
    expect(store.refundCases[0].status).toBe('processed');
    // The payment attempt itself is never rewritten by a refund event.
    expect(store.attempts.find((a) => a.id === attempt.id).status).toBe('succeeded');
    expect(mockSendNotification.mock.calls[0][0]).toMatchObject({ type: 'logistics:refund_processed' });
  });

  test('charge.refunded with our refund still pending leaves the case executing', async () => {
    seedPendingRefundFlow();
    const result = await paymentsService.handleStripeEvent({
      id: 'evt_cr_3',
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_1',
          payment_intent: 'pi_test_1',
          amount_refunded: 10000,
          currency: 'usd',
          refunds: { data: [{ id: 're_pend_1', status: 'pending', metadata: {} }] },
        },
      },
    });

    expect(result).toMatchObject({ handled: true, outcome: 'refund_still_pending' });
    expect(store.refundCases[0].status).toBe('executing');
    expect(mockSendNotification).not.toHaveBeenCalled();
  });
});
