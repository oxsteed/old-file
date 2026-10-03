'use strict';

/**
 * Agent OxSteed Credit adjustments: the two-person rule and fail-closed
 * money movement, proved against the real controller with the mocked pg
 * pool (server/__tests__/setup.js) and a mocked credit service (only the
 * two money-touching functions are stubbed; helpers stay real).
 *
 * NOTE: setup.js replaces withTransaction with a test double that runs the
 * operation with pool.query as the client (no BEGIN/COMMIT), so queued
 * mockQuery responses line up with the controller's logical queries only.
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/oxsteedCreditService', () => {
  const actual = jest.requireActual('../services/oxsteedCreditService');
  return {
    ...actual,
    assertCreditRailEnabled: jest.fn(),
    adjustCustomerCreditInTransaction: jest.fn(),
  };
});

const creditService = require('../services/oxsteedCreditService');
const AppError = require('../utils/appError');
const controller = require('../controllers/agentCreditAdjustmentController');

const ADMIN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // proposer
const ADMIN_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // second admin
const CUSTOMER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ADJ_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function reqDouble(overrides = {}) {
  return {
    body: {},
    query: {},
    params: {},
    ip: '127.0.0.1',
    user: { id: ADMIN_A },
    ...overrides,
  };
}

function resDouble() {
  const res = {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  return res;
}

const throwingNext = (err) => { throw err; };

function pendingRow(overrides = {}) {
  return {
    id: ADJ_ID,
    customer_id: CUSTOMER,
    amount_cents: 5000,
    currency_code: 'USD',
    reason: 'Goodwill credit for a ruined birthday dinner',
    proposed_by: ADMIN_A,
    approved_by: null,
    status: 'pending',
    idempotency_key: 'agent-key-1',
    before_balance_cents: null,
    after_balance_cents: null,
    reject_reason: null,
    ledger_transaction_id: null,
    proposed_at: new Date().toISOString(),
    approved_at: null,
    applied_at: null,
    decided_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function emptyResult() {
  return { rows: [], rowCount: 0 };
}

// Queues the mockQuery responses for the apply-leg of an adjustment:
// rail assert is mocked, the ledger posting is mocked, everything else is
// the controller's own SQL in order.
function queueApplyLeg({ usedToday = '0', beforeCents = '10000', afterCents = '15000', appliedOverrides = {} }) {
  const appliedRow = pendingRow({
    status: 'applied',
    approved_by: ADMIN_B,
    before_balance_cents: Number(beforeCents),
    after_balance_cents: Number(afterCents),
    ledger_transaction_id: 77,
    ...appliedOverrides,
  });
  mockQuery
    .mockResolvedValueOnce(emptyResult()) // advisory lock (apply)
    .mockResolvedValueOnce({ rows: [{ used_today: usedToday }] }) // daily cap
    .mockResolvedValueOnce({ rows: [{ balance_cents: beforeCents }] }) // before balance
    // adjustCustomerCreditInTransaction is mocked: no SQL here
    .mockResolvedValueOnce({ rows: [{ balance_cents: afterCents }] }) // after balance
    .mockResolvedValueOnce({ rows: [appliedRow], rowCount: 1 }) // UPDATE -> applied
    .mockResolvedValueOnce(emptyResult()); // audit applied
  return appliedRow;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  creditService.assertCreditRailEnabled.mockResolvedValue(undefined);
  creditService.adjustCustomerCreditInTransaction.mockResolvedValue({ transaction: { id: 77 } });
});

describe('proposeAdjustment validation', () => {
  test('empty reason is rejected with 400 and never touches the database', async () => {
    let error = null;
    try {
      await controller.proposeAdjustment(
        reqDouble({ body: { customerId: CUSTOMER, amountCents: 4999, reason: '   ', idempotencyKey: 'k-empty' } }),
        resDouble(),
        throwingNext
      );
    } catch (err) { error = err; }
    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(400);
    expect(error.code).toBe('credit_adjustment_reason_required');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('missing idempotency key is rejected with 400', async () => {
    let error = null;
    try {
      await controller.proposeAdjustment(
        reqDouble({ body: { customerId: CUSTOMER, amountCents: 4999, reason: 'valid reason' } }),
        resDouble(),
        throwingNext
      );
    } catch (err) { error = err; }
    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(400);
    expect(error.code).toBe('credit_idempotency_key_required');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('two-person rule', () => {
  test('the proposer CANNOT self-approve: 403 two-person violation', async () => {
    mockQuery
      .mockResolvedValueOnce(emptyResult()) // advisory lock (propose)
      .mockResolvedValueOnce({ rows: [pendingRow()], rowCount: 1 }) // INSERT propose
      .mockResolvedValueOnce(emptyResult()); // audit proposed

    const proposeRes = resDouble();
    await controller.proposeAdjustment(
      reqDouble({ body: { customerId: CUSTOMER, amountCents: 5000, reason: 'ruined dinner credit', idempotencyKey: 'k-self-approve' } }),
      proposeRes,
      throwingNext
    );
    expect(proposeRes.statusCode).toBe(201);
    expect(proposeRes.payload.adjustment.status).toBe('pending');
    // Exactly at the $50 threshold: stays pending, needs a second human.
    expect(proposeRes.payload.adjustment.requiresSecondApproval).toBe(true);

    mockQuery.mockReset();
    mockQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
    mockQuery.mockResolvedValueOnce({ rows: [pendingRow()], rowCount: 1 }); // SELECT FOR UPDATE

    let error = null;
    try {
      await controller.approveAdjustment(
        reqDouble({ params: { id: ADJ_ID } }), // same admin A
        resDouble(),
        throwingNext
      );
    } catch (err) { error = err; }

    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(403);
    expect(error.code).toBe('credit_adjustment_two_person_violation');
    // Money never moved: no posting, no applied UPDATE.
    expect(creditService.adjustCustomerCreditInTransaction).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls.some(([sql]) => /status = 'applied'/.test(sql))).toBe(false);
  });

  test('at the $50 threshold a DIFFERENT admin approves and the posting applies atomically', async () => {
    mockQuery
      .mockResolvedValueOnce(emptyResult()) // advisory lock (propose)
      .mockResolvedValueOnce({ rows: [pendingRow()], rowCount: 1 }) // INSERT propose
      .mockResolvedValueOnce(emptyResult()); // audit proposed

    const proposeRes = resDouble();
    await controller.proposeAdjustment(
      reqDouble({ body: { customerId: CUSTOMER, amountCents: 5000, reason: 'ruined dinner credit', idempotencyKey: 'k-two-admins' } }),
      proposeRes,
      throwingNext
    );
    expect(proposeRes.payload.adjustment.status).toBe('pending');

    mockQuery.mockReset();
    mockQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
    const approvedRow = pendingRow({ status: 'approved', approved_by: ADMIN_B });
    mockQuery
      .mockResolvedValueOnce({ rows: [pendingRow()], rowCount: 1 }) // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [approvedRow], rowCount: 1 }) // UPDATE -> approved
      .mockResolvedValueOnce(emptyResult()); // audit approved
    queueApplyLeg({});

    const approveRes = resDouble();
    await controller.approveAdjustment(
      reqDouble({ params: { id: ADJ_ID }, user: { id: ADMIN_B } }),
      approveRes,
      throwingNext
    );

    expect(approveRes.statusCode).toBe(200);
    expect(approveRes.payload.adjustment.status).toBe('applied');
    expect(approveRes.payload.adjustment.approvedBy).toBe(ADMIN_B);
    expect(approveRes.payload.adjustment.beforeBalanceCents).toBe(10000);
    expect(approveRes.payload.adjustment.afterBalanceCents).toBe(15000);

    // The money movement reused the real journal path with the right shape.
    expect(creditService.adjustCustomerCreditInTransaction).toHaveBeenCalledTimes(1);
    const [client, posting] = creditService.adjustCustomerCreditInTransaction.mock.calls[0];
    expect(client).toBeTruthy();
    expect(posting).toMatchObject({
      customerId: CUSTOMER,
      amountCents: 5000,
      direction: 'credit',
      currencyCode: 'USD',
      actorType: 'admin',
      actorUserId: ADMIN_B,
      referenceType: 'agent_credit_adjustment',
      referenceId: `credit_adjustment:${ADJ_ID}`,
    });
    expect(posting.idempotencyKey).toContain(`agent-credit-adjustment:${ADJ_ID}`);
    expect(posting.reason).toBe('Goodwill credit for a ruined birthday dinner');
  });

  test('a negative amount (debit) posts with direction debit', async () => {
    mockQuery
      .mockResolvedValueOnce(emptyResult()) // advisory lock (propose)
      .mockResolvedValueOnce({ rows: [pendingRow({ amount_cents: -8000 })], rowCount: 1 }) // INSERT propose
      .mockResolvedValueOnce(emptyResult()); // audit proposed

    const proposeRes = resDouble();
    await controller.proposeAdjustment(
      reqDouble({ body: { customerId: CUSTOMER, amountCents: -8000, reason: 'clawback of duplicate grant', idempotencyKey: 'k-debit' } }),
      proposeRes,
      throwingNext
    );
    expect(proposeRes.payload.adjustment.status).toBe('pending');
    expect(proposeRes.payload.adjustment.direction).toBe('debit');

    mockQuery.mockReset();
    mockQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
    const approvedRow = pendingRow({ amount_cents: -8000, status: 'approved', approved_by: ADMIN_B });
    mockQuery
      .mockResolvedValueOnce({ rows: [pendingRow({ amount_cents: -8000 })], rowCount: 1 }) // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [approvedRow], rowCount: 1 }) // UPDATE -> approved
      .mockResolvedValueOnce(emptyResult()); // audit approved
    queueApplyLeg({
      beforeCents: '20000', afterCents: '12000',
      appliedOverrides: { amount_cents: -8000, before_balance_cents: 20000, after_balance_cents: 12000 },
    });

    await controller.approveAdjustment(
      reqDouble({ params: { id: ADJ_ID }, user: { id: ADMIN_B } }),
      resDouble(),
      throwingNext
    );

    const posting = creditService.adjustCustomerCreditInTransaction.mock.calls[0][1];
    expect(posting.amountCents).toBe(8000);
    expect(posting.direction).toBe('debit');
  });
});

describe('below-threshold single-admin apply', () => {
  test('propose under $50 auto-applies in the same call with a reason', async () => {
    const row = pendingRow({ amount_cents: 4999 });
    mockQuery
      .mockResolvedValueOnce(emptyResult()) // advisory lock (propose)
      .mockResolvedValueOnce({ rows: [row], rowCount: 1 }) // INSERT propose
      .mockResolvedValueOnce(emptyResult()) // audit proposed
      .mockResolvedValueOnce({ rows: [row], rowCount: 1 }); // SELECT FOR UPDATE
    queueApplyLeg({
      beforeCents: '2000', afterCents: '6999',
      appliedOverrides: { amount_cents: 4999, approved_by: ADMIN_A, before_balance_cents: 2000, after_balance_cents: 6999 },
    });

    const res = resDouble();
    await controller.proposeAdjustment(
      reqDouble({ body: { customerId: CUSTOMER, amountCents: 4999, reason: 'small goodwill credit', idempotencyKey: 'k-auto' } }),
      res,
      throwingNext
    );

    expect(res.statusCode).toBe(201);
    expect(res.payload.adjustment.status).toBe('applied');
    expect(res.payload.adjustment.beforeBalanceCents).toBe(2000);
    expect(res.payload.adjustment.afterBalanceCents).toBe(6999);
    expect(creditService.adjustCustomerCreditInTransaction).toHaveBeenCalledTimes(1);
    expect(creditService.adjustCustomerCreditInTransaction.mock.calls[0][1].actorUserId).toBe(ADMIN_A);
  });
});

describe('idempotent propose', () => {
  test('same idempotency key twice returns the one existing record, never duplicates', async () => {
    const row = pendingRow({ amount_cents: 5000 });
    mockQuery
      .mockResolvedValueOnce(emptyResult()) // advisory lock (propose)
      .mockResolvedValueOnce({ rows: [row], rowCount: 1 }) // INSERT propose
      .mockResolvedValueOnce(emptyResult()); // audit proposed

    const first = resDouble();
    await controller.proposeAdjustment(
      reqDouble({ body: { customerId: CUSTOMER, amountCents: 5000, reason: 'dup check', idempotencyKey: 'k-dup' } }),
      first,
      throwingNext
    );
    expect(first.statusCode).toBe(201);
    expect(first.payload.replayed).toBe(false);

    mockQuery.mockReset();
    mockQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
    mockQuery
      .mockResolvedValueOnce(emptyResult()) // advisory lock (propose)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // INSERT ON CONFLICT DO NOTHING
      .mockResolvedValueOnce({ rows: [row], rowCount: 1 }); // SELECT existing

    const second = resDouble();
    await controller.proposeAdjustment(
      reqDouble({ body: { customerId: CUSTOMER, amountCents: 5000, reason: 'dup check', idempotencyKey: 'k-dup' } }),
      second,
      throwingNext
    );

    expect(second.statusCode).toBe(200);
    expect(second.payload.replayed).toBe(true);
    expect(second.payload.adjustment.id).toBe(ADJ_ID);
    const inserts = mockQuery.mock.calls.filter(([sql]) => /^INSERT INTO credit_adjustments/i.test(sql));
    expect(inserts).toHaveLength(1);
    expect(inserts[0][0]).toMatch(/ON CONFLICT \(idempotency_key\) DO NOTHING/);
  });
});

describe('fail closed', () => {
  test('disabled rail: adjustment stays pending, nothing posts', async () => {
    creditService.assertCreditRailEnabled.mockRejectedValue(
      new AppError('OxSteed Credit is temporarily suspended', 503, 'credit_rail_suspended')
    );

    const row = pendingRow({ amount_cents: 4999 });
    mockQuery
      .mockResolvedValueOnce(emptyResult()) // advisory lock (propose)
      .mockResolvedValueOnce({ rows: [row], rowCount: 1 }) // INSERT propose
      .mockResolvedValueOnce(emptyResult()) // audit proposed
      .mockResolvedValueOnce({ rows: [row], rowCount: 1 }); // SELECT FOR UPDATE
      // rail assert throws here; the transaction aborts before any posting

    let error = null;
    try {
      await controller.proposeAdjustment(
        reqDouble({ body: { customerId: CUSTOMER, amountCents: 4999, reason: 'rail is down', idempotencyKey: 'k-rail-down' } }),
        resDouble(),
        throwingNext
      );
    } catch (err) { error = err; }

    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(503);
    expect(error.code).toBe('credit_rail_suspended');
    expect(creditService.adjustCustomerCreditInTransaction).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls.some(([sql]) => /status = 'applied'/.test(sql))).toBe(false);
  });
});

describe('audit trail', () => {
  test('propose + auto-apply writes audit entries carrying actor, reason, amount and before/after balances', async () => {
    const row = pendingRow({ amount_cents: 4999, reason: 'audit trail check' });
    mockQuery
      .mockResolvedValueOnce(emptyResult()) // advisory lock (propose)
      .mockResolvedValueOnce({ rows: [row], rowCount: 1 }) // INSERT propose
      .mockResolvedValueOnce(emptyResult()) // audit proposed
      .mockResolvedValueOnce({ rows: [row], rowCount: 1 }); // SELECT FOR UPDATE
    queueApplyLeg({
      beforeCents: '2000', afterCents: '6999',
      appliedOverrides: { amount_cents: 4999, reason: 'audit trail check', approved_by: ADMIN_A, before_balance_cents: 2000, after_balance_cents: 6999 },
    });

    await controller.proposeAdjustment(
      reqDouble({ body: { customerId: CUSTOMER, amountCents: 4999, reason: 'audit trail check', idempotencyKey: 'k-audit' } }),
      resDouble(),
      throwingNext
    );

    const auditCalls = mockQuery.mock.calls.filter(([sql]) => /INSERT INTO oxsteed_credit_audit_events/.test(sql));
    expect(auditCalls.length).toBeGreaterThanOrEqual(2);

    const appliedAudit = auditCalls[auditCalls.length - 1];
    const params = appliedAudit[1];
    expect(appliedAudit[0]).toMatch(/'credit_adjustment'/); // resource_type
    expect(params[0]).toBe('credit.agent_adjustment.applied');
    expect(params[1]).toBe(ADMIN_A); // actor
    expect(params[2]).toBe(CUSTOMER); // customer
    expect(params[4]).toBe('audit trail check'); // reason
    expect(JSON.parse(params[7]).beforeBalanceCents).toBe(2000);
    expect(JSON.parse(params[8]).afterBalanceCents).toBe(6999);
  });
});

describe('daily cap', () => {
  test('rejects when the admin already used $490 today and requests $20 more', async () => {
    const row = pendingRow({ amount_cents: 2000 });
    mockQuery
      .mockResolvedValueOnce(emptyResult()) // advisory lock (propose)
      .mockResolvedValueOnce({ rows: [row], rowCount: 1 }) // INSERT propose
      .mockResolvedValueOnce(emptyResult()) // audit proposed
      .mockResolvedValueOnce({ rows: [row], rowCount: 1 }) // SELECT FOR UPDATE
      .mockResolvedValueOnce(emptyResult()) // advisory lock (apply)
      .mockResolvedValueOnce({ rows: [{ used_today: '49000' }] }); // daily cap -> 49000 + 2000 > 50000

    let error = null;
    try {
      await controller.proposeAdjustment(
        reqDouble({ body: { customerId: CUSTOMER, amountCents: 2000, reason: 'over the cap', idempotencyKey: 'k-cap' } }),
        resDouble(),
        throwingNext
      );
    } catch (err) { error = err; }

    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(422);
    expect(error.code).toBe('credit_adjustment_daily_cap_exceeded');
    expect(error.fields.dailyCapCents).toBe('50000');
    expect(error.fields.usedTodayCents).toBe('49000');
    expect(creditService.adjustCustomerCreditInTransaction).not.toHaveBeenCalled();
  });
});

describe('reject and cancel', () => {
  test('a different admin can reject a pending adjustment with a reason', async () => {
    const rejectedRow = pendingRow({ status: 'rejected', reject_reason: 'Duplicate of adjustment #12' });
    mockQuery
      .mockResolvedValueOnce({ rows: [pendingRow()], rowCount: 1 }) // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [rejectedRow], rowCount: 1 }) // UPDATE -> rejected
      .mockResolvedValueOnce(emptyResult()); // audit

    const res = resDouble();
    await controller.rejectAdjustment(
      reqDouble({ params: { id: ADJ_ID }, user: { id: ADMIN_B }, body: { reason: 'Duplicate of adjustment #12' } }),
      res,
      throwingNext
    );
    expect(res.statusCode).toBe(200);
    expect(res.payload.adjustment.status).toBe('rejected');
    expect(creditService.adjustCustomerCreditInTransaction).not.toHaveBeenCalled();
  });

  test('the proposer cannot reject their own proposal, but can cancel it', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [pendingRow()], rowCount: 1 }); // SELECT FOR UPDATE
    let error = null;
    try {
      await controller.rejectAdjustment(
        reqDouble({ params: { id: ADJ_ID }, body: { reason: 'changing my mind' } }),
        resDouble(),
        throwingNext
      );
    } catch (err) { error = err; }
    expect(error?.code).toBe('credit_adjustment_reject_self_forbidden');

    mockQuery.mockReset();
    mockQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
    const cancelledRow = pendingRow({ status: 'cancelled' });
    mockQuery
      .mockResolvedValueOnce({ rows: [pendingRow()], rowCount: 1 }) // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [cancelledRow], rowCount: 1 }) // UPDATE -> cancelled
      .mockResolvedValueOnce(emptyResult()); // audit

    const res = resDouble();
    await controller.cancelAdjustment(reqDouble({ params: { id: ADJ_ID } }), res, throwingNext);
    expect(res.statusCode).toBe(200);
    expect(res.payload.adjustment.status).toBe('cancelled');
  });
});

describe('listPendingAdjustments', () => {
  test('returns the pending queue with proposer names and policy thresholds', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      ...pendingRow(),
      proposed_first_name: 'Maya', proposed_last_name: 'L', proposed_email: 'maya@example.com',
    }] });

    const res = resDouble();
    await controller.listPendingAdjustments(reqDouble({ query: {} }), res, throwingNext);
    expect(res.statusCode).toBe(200);
    expect(res.payload.adjustments).toHaveLength(1);
    expect(res.payload.adjustments[0].proposedByName).toBe('Maya L');
    expect(res.payload.thresholdCents).toBe(5000);
    expect(res.payload.dailyCapCents).toBe(50000);
  });
});
