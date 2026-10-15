'use strict';

/**
 * Phase 3 dual-admin refunds — money-safety proof suite.
 *
 * Tests the service layer (server/services/logisticsRefundService.js) against
 * an in-memory fake DB, with injected fake ports. Proves:
 *  - self-approval is rejected (403)
 *  - different-admin approval works
 *  - refunds are capped at the remaining refundable amount (server-side)
 *  - double execution is safe (idempotent, no double refund)
 *  - stale / missing fresh auth is rejected
 *  - unauthorized payment states / unknown attempts fail closed
 *  - failed executions land in the reconciliation queue
 *  - credit refunds fail closed until the Credit workstream registers
 */

const svc = require('../services/logisticsRefundService');

// ─── In-memory fake DB ───────────────────────────────────────

function makeFakeDb() {
  const db = {
    cases: [],
    decisions: [],
    recon: [],
    txLog: [],
    nextId: 1,
  };

  function findCase(id) {
    return db.cases.find((c) => String(c.id) === String(id)) || null;
  }

  async function query(sql, params = []) {
    const s = String(sql);
    if (/^\s*BEGIN/i.test(s)) { db.txLog.push('BEGIN'); return { rows: [] }; }
    if (/^\s*COMMIT/i.test(s)) { db.txLog.push('COMMIT'); return { rows: [] }; }
    if (/^\s*ROLLBACK/i.test(s)) { db.txLog.push('ROLLBACK'); return { rows: [] }; }

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
      // Service SQL: VALUES ('logistics_refund', $1, $2, $3, 'pending')
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
    if (/SET status = 'rejected'/.test(s)) {
      const kase = findCase(params[0]);
      kase.status = 'rejected';
      kase.rejection_reason = params[1];
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
    if (/SET status = 'processed'/.test(s)) {
      const kase = findCase(params[0]);
      kase.status = 'processed';
      if (s.includes('stripe_refund_id')) kase.stripe_refund_id = params[1];
      if (s.includes('processor_ref')) kase.processor_ref = params[1];
      kase.processed_by = params[2];
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
    throw new Error(`fakeDb: unhandled SQL: ${s.slice(0, 120)}`);
  }

  return { db, query };
}

// ─── Fake ports ──────────────────────────────────────────────

function makePorts(overrides = {}) {
  const calls = { notify: [], stripeRefunds: [], creditReversals: [] };
  const attempt = {
    id: 'attempt-1',
    buyerUserId: 'buyer-1',
    amountCents: 10000, // $100.00 paid
    currency: 'USD',
    method: 'stripe',
    status: 'succeeded', // 879: only 'succeeded' attempts are refundable
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
        if (overrides.creditAdapter) return overrides.creditAdapter(args);
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

function freshAuth(minutesAgo = 2) {
  return {
    completedAt: new Date(Date.now() - minutesAgo * 60 * 1000),
    authHash: 'hash-abc',
    method: 'totp',
  };
}

// Binds the fake DB query + a passthrough withTransaction to the ports.
function bindDb(ports, query) {
  ports.query = query;
  ports.withTransaction = async (work) => work(query);
  return ports;
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

// ─── Tests ───────────────────────────────────────────────────

describe('proposeRefund', () => {
  test('creates a proposed case with proposed_by and an audit decision, and notifies the buyer', async () => {
    const { query, db } = makeFakeDb();
    const ports = bindDb(makePorts(), query);
    const kase = await proposeOk(ports);
    expect(kase.status).toBe('proposed');
    expect(kase.proposed_by).toBe('admin-1');
    expect(kase.amount_cents).toBe(4000);
    expect(kase.refund_method).toBe('stripe');
    expect(kase.reference).toMatch(/^LR-/);
    expect(db.decisions).toHaveLength(1);
    expect(db.decisions[0]).toMatchObject({ action: 'propose', actor_user_id: 'admin-1' });
    expect(ports.calls.notify).toHaveLength(1);
    expect(ports.calls.notify[0]).toMatchObject({ event: 'refund_proposed', userId: 'buyer-1' });
  });

  test('rejects amounts above the remaining refundable amount (server-side cap)', async () => {
    const { query } = makeFakeDb();
    const ports = bindDb(makePorts(), query);
    await expect(proposeOk(ports, { amountCents: 10001 }))
      .rejects.toMatchObject({ statusCode: 400, code: 'refund_amount_exceeds_remaining' });
  });

  test('partial refunds are capped by prior refunds on the same attempt', async () => {
    const { query, db } = makeFakeDb();
    const ports = bindDb(makePorts(), query);
    // First: propose/approve/execute a $40 refund.
    const c1 = await proposeOk(ports, { amountCents: 4000 });
    await svc.approveRefund(ports, { caseId: c1.id, approverUserId: 'admin-2', freshAuthEvent: freshAuth() });
    await svc.executeRefund(ports, { caseId: c1.id, actorUserId: 'admin-2' });
    expect(db.cases[0].status).toBe('processed');
    // $70 more exceeds the remaining $60.
    await expect(proposeOk(ports, { amountCents: 7000, proposerUserId: 'admin-3' }))
      .rejects.toMatchObject({ code: 'refund_amount_exceeds_remaining' });
    // $60 exactly is allowed.
    const c2 = await proposeOk(ports, { amountCents: 6000, proposerUserId: 'admin-3' });
    expect(c2.status).toBe('proposed');
  });

  test('concurrent proposals encumber the balance: a second proposal cannot overdraw', async () => {
    const { query } = makeFakeDb();
    const ports = bindDb(makePorts(), query);
    // $100 paid. First proposal reserves $70 while still 'proposed'.
    await proposeOk(ports, { amountCents: 7000, proposerUserId: 'admin-1' });
    // Second proposal for $40 must fail: only $30 remains.
    await expect(proposeOk(ports, { amountCents: 4000, proposerUserId: 'admin-2' }))
      .rejects.toMatchObject({ code: 'refund_amount_exceeds_remaining' });
    // $30 exactly is allowed.
    const c2 = await proposeOk(ports, { amountCents: 3000, proposerUserId: 'admin-2' });
    expect(c2.status).toBe('proposed');
  });

  test('fails closed on an unknown payment attempt', async () => {
    const { query } = makeFakeDb();
    const ports = bindDb(makePorts(), query);
    await expect(proposeOk(ports, { paymentAttemptId: 'nope' }))
      .rejects.toMatchObject({ code: 'refund_payment_attempt_not_found' });
  });

  test('rejects method mismatch: funds must return to the original source', async () => {
    const { query } = makeFakeDb();
    const ports = bindDb(makePorts({ attempt: { method: 'credit' } }), query);
    await expect(proposeOk(ports, { refundMethod: 'stripe' }))
      .rejects.toMatchObject({ code: 'refund_method_mismatch' });
  });

  test('rejects non-USD and non-paid attempts', async () => {
    const { query } = makeFakeDb();
    let ports = bindDb(makePorts({ attempt: { currency: 'EUR' } }), query);
    await expect(proposeOk(ports)).rejects.toMatchObject({ code: 'refund_currency_not_supported' });
    ports = bindDb(makePorts({ attempt: { status: 'voided' } }), query);
    await expect(proposeOk(ports)).rejects.toMatchObject({ code: 'refund_payment_not_refundable' });
  });
});

describe('approveRefund', () => {
  test('a different admin with fresh auth approves; decision records the fresh-auth hash', async () => {
    const { query, db } = makeFakeDb();
    const ports = bindDb(makePorts(), query);
    const kase = await proposeOk(ports);
    const approved = await svc.approveRefund(ports, {
      caseId: kase.id, approverUserId: 'admin-2', freshAuthEvent: freshAuth(), reason: 'Verified with buyer',
    });
    expect(approved.status).toBe('approved');
    expect(approved.approved_by).toBe('admin-2');
    expect(approved.fresh_auth_at).toBeTruthy();
    const dec = db.decisions.find((d) => d.action === 'approve');
    expect(dec).toMatchObject({ actor_user_id: 'admin-2', fresh_auth_ref: 'hash-abc' });
    expect(ports.calls.notify.map((n) => n.event)).toContain('refund_approved');
  });

  test('self-approval is rejected with 403', async () => {
    const { query } = makeFakeDb();
    const ports = bindDb(makePorts(), query);
    const kase = await proposeOk(ports); // proposed by admin-1
    await expect(svc.approveRefund(ports, {
      caseId: kase.id, approverUserId: 'admin-1', freshAuthEvent: freshAuth(),
    })).rejects.toMatchObject({ statusCode: 403, code: 'refund_self_approval_forbidden' });
  });

  test('stale fresh auth is rejected (401)', async () => {
    const { query } = makeFakeDb();
    const ports = bindDb(makePorts(), query);
    const kase = await proposeOk(ports);
    await expect(svc.approveRefund(ports, {
      caseId: kase.id, approverUserId: 'admin-2', freshAuthEvent: freshAuth(30),
    })).rejects.toMatchObject({ statusCode: 401, code: 'fresh_auth_required' });
  });

  test('missing fresh auth is rejected (401)', async () => {
    const { query } = makeFakeDb();
    const ports = bindDb(makePorts(), query);
    const kase = await proposeOk(ports);
    await expect(svc.approveRefund(ports, {
      caseId: kase.id, approverUserId: 'admin-2', freshAuthEvent: null,
    })).rejects.toMatchObject({ statusCode: 401, code: 'fresh_auth_required' });
  });

  test('only proposed cases can be approved', async () => {
    const { query } = makeFakeDb();
    const ports = bindDb(makePorts(), query);
    const kase = await proposeOk(ports);
    await svc.approveRefund(ports, { caseId: kase.id, approverUserId: 'admin-2', freshAuthEvent: freshAuth() });
    await expect(svc.approveRefund(ports, {
      caseId: kase.id, approverUserId: 'admin-3', freshAuthEvent: freshAuth(),
    })).rejects.toMatchObject({ statusCode: 409, code: 'refund_invalid_state' });
  });
});

describe('rejectRefund', () => {
  test('a different admin can reject with a reason', async () => {
    const { query, db } = makeFakeDb();
    const ports = bindDb(makePorts(), query);
    const kase = await proposeOk(ports);
    const rejected = await svc.rejectRefund(ports, { caseId: kase.id, actorUserId: 'admin-2', reason: 'Duplicate request' });
    expect(rejected.status).toBe('rejected');
    expect(rejected.rejection_reason).toBe('Duplicate request');
    expect(db.decisions.some((d) => d.action === 'reject')).toBe(true);
    expect(ports.calls.notify.map((n) => n.event)).toContain('refund_rejected');
  });

  test('the proposer cannot reject their own proposal', async () => {
    const { query } = makeFakeDb();
    const ports = bindDb(makePorts(), query);
    const kase = await proposeOk(ports);
    await expect(svc.rejectRefund(ports, { caseId: kase.id, actorUserId: 'admin-1', reason: 'oops' }))
      .rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('executeRefund', () => {
  async function approvedCase(ports, overrides = {}) {
    const kase = await proposeOk(ports, overrides);
    return svc.approveRefund(ports, { caseId: kase.id, approverUserId: 'admin-2', freshAuthEvent: freshAuth() });
  }

  test('executes on Stripe confirmation; deterministic idempotency key is passed', async () => {
    const { query, db } = makeFakeDb();
    const ports = bindDb(makePorts(), query);
    const approved = await approvedCase(ports);
    const { case: kase, replayed, failed } = await svc.executeRefund(ports, { caseId: approved.id, actorUserId: 'admin-3' });
    expect(failed).toBeFalsy();
    expect(replayed).toBeFalsy();
    expect(kase.status).toBe('processed');
    expect(kase.stripe_refund_id).toBe('re_1');
    expect(kase.processed_by).toBe('admin-3');
    expect(kase.processed_at).toBeTruthy();
    expect(ports.calls.stripeRefunds).toHaveLength(1);
    expect(ports.calls.stripeRefunds[0]).toMatchObject({
      chargeId: 'ch_1',
      amountCents: 4000,
      idempotencyKey: svc.executionIdempotencyKey(approved.id),
    });
    expect(db.decisions.some((d) => d.action === 'execute')).toBe(true);
    expect(ports.calls.notify.map((n) => n.event)).toContain('refund_processed');
  });

  test('double execution is safe: replay returns the processed case without a second Stripe call', async () => {
    const { query } = makeFakeDb();
    const ports = bindDb(makePorts(), query);
    const approved = await approvedCase(ports);
    const first = await svc.executeRefund(ports, { caseId: approved.id, actorUserId: 'admin-3' });
    expect(first.case.status).toBe('processed');
    const second = await svc.executeRefund(ports, { caseId: approved.id, actorUserId: 'admin-3' });
    expect(second.replayed).toBe(true);
    expect(second.case.status).toBe('processed');
    expect(ports.calls.stripeRefunds).toHaveLength(1); // no double refund
  });

  test('Stripe failure -> failed status + reconciliation queue + buyer notified (no silent loss)', async () => {
    const { query, db } = makeFakeDb();
    const stripeError = new Error('card declined by issuer');
    stripeError.code = 'stripe_card_error';
    const ports = bindDb(makePorts({ stripeError }), query);
    const approved = await approvedCase(ports);
    const { case: kase, failed, code } = await svc.executeRefund(ports, { caseId: approved.id, actorUserId: 'admin-3' });
    expect(failed).toBe(true);
    expect(code).toBe('stripe_card_error');
    expect(kase.status).toBe('failed');
    expect(kase.stripe_refund_id).toBeFalsy(); // never marked processed
    expect(db.recon).toHaveLength(1);
    expect(db.recon[0]).toMatchObject({ source: 'logistics_refund', entity_id: approved.id, status: 'pending' });
    expect(db.decisions.some((d) => d.action === 'execute_failed')).toBe(true);
    expect(ports.calls.notify.map((n) => n.event)).toContain('refund_failed');
  });

  test('open dispute blocks execution (fail closed)', async () => {
    const { query } = makeFakeDb();
    const ports = bindDb(makePorts({ dispute: { known: true, open: true } }), query);
    const approved = await approvedCase(ports);
    const { case: kase, failed, code } = await svc.executeRefund(ports, { caseId: approved.id, actorUserId: 'admin-3' });
    expect(failed).toBe(true);
    expect(code).toBe('refund_dispute_open');
    expect(kase.status).toBe('failed');
    expect(ports.calls.stripeRefunds).toHaveLength(0); // no money moved
  });

  test('unknown dispute status blocks execution (fail closed)', async () => {
    const { query } = makeFakeDb();
    const ports = bindDb(makePorts({ dispute: { known: false, open: false } }), query);
    const approved = await approvedCase(ports);
    const { failed, code } = await svc.executeRefund(ports, { caseId: approved.id, actorUserId: 'admin-3' });
    expect(failed).toBe(true);
    expect(code).toBe('refund_dispute_status_unknown');
    expect(ports.calls.stripeRefunds).toHaveLength(0);
  });

  test('approver who lost admin rights blocks execution (fail closed)', async () => {
    const { query } = makeFakeDb();
    const ports = bindDb(makePorts({ approver: { id: 'admin-2', role: 'support', isBanned: false } }), query);
    const approved = await approvedCase(ports);
    const { failed, code } = await svc.executeRefund(ports, { caseId: approved.id, actorUserId: 'admin-3' });
    expect(failed).toBe(true);
    expect(code).toBe('refund_approver_no_longer_authorized');
  });

  test('credit refund fails closed until the Credit workstream registers its adapter', async () => {
    const { query, db } = makeFakeDb();
    const ports = bindDb(makePorts({ attempt: { method: 'credit' } }), query);
    const proposed = await proposeOk(ports, { refundMethod: 'credit' });
    const approved = await svc.approveRefund(ports, { caseId: proposed.id, approverUserId: 'admin-2', freshAuthEvent: freshAuth() });
    const { case: kase, failed, code } = await svc.executeRefund(ports, { caseId: approved.id, actorUserId: 'admin-3' });
    expect(failed).toBe(true);
    expect(code).toBe('credit_reversal_unavailable');
    expect(kase.status).toBe('failed');
    expect(db.recon).toHaveLength(1); // queued for reconciliation, not lost
  });

  test('non-approved cases cannot be executed', async () => {
    const { query } = makeFakeDb();
    const ports = bindDb(makePorts(), query);
    const kase = await proposeOk(ports); // still proposed
    await expect(svc.executeRefund(ports, { caseId: kase.id, actorUserId: 'admin-3' }))
      .rejects.toMatchObject({ statusCode: 409, code: 'refund_invalid_state' });
  });
});

describe('expireStaleProposals', () => {
  test('expires proposals older than the TTL, keeps fresh ones', async () => {
    const { query, db } = makeFakeDb();
    const ports = bindDb(makePorts(), query);
    const old = await proposeOk(ports, { amountCents: 1000 });
    const fresh = await proposeOk(ports, { amountCents: 1000 });
    db.cases.find((c) => c.id === old.id).created_at = new Date(Date.now() - 80 * 3600 * 1000);
    const { expired } = await svc.expireStaleProposals(ports, { olderThanHours: 72 });
    expect(expired).toBe(1);
    expect(db.cases.find((c) => c.id === old.id).status).toBe('expired');
    expect(db.cases.find((c) => c.id === fresh.id).status).toBe('proposed');
    expect(ports.calls.notify.map((n) => n.event)).toContain('refund_expired');
  });
});
