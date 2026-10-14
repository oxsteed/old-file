'use strict';

/**
 * dualApprovalService.test.js — ADM-016
 *
 * Behavior contract for the maker-checker gate on money movements:
 * - Below-threshold movements execute immediately ({ queued: false }).
 * - At/above-threshold movements are queued 'pending' and move nothing.
 * - Idempotency-key replays return the existing approval (no duplicates).
 * - Self-approval is forbidden (403), even though the DB CHECK also guards it.
 * - Approval runs the rail executor inside the same transaction that flips
 *   the row to executed (fail-closed: executor throw -> stays pending).
 * - Reject is terminal.
 * - Unknown movement types fail closed.
 */

const { mockQuery, resetMocks } = require('./setup');

const dualApproval = require('../services/dualApprovalService');

const MAKER = '00000000-0000-4000-8000-000000000001';
const CHECKER = '00000000-0000-4000-8000-000000000002';

function approvalRow(overrides = {}) {
  return {
    id: 42,
    movement_type: 'job_refund',
    reference_key: 'job:9',
    amount_cents: 60000,
    currency_code: 'USD',
    requested_by: MAKER,
    requested_at: new Date().toISOString(),
    idempotency_key: 'dual-approval:job_refund:test-key-1',
    payload: { jobId: '9' },
    status: 'pending',
    decided_by: null,
    decided_at: null,
    decision_reason: null,
    executed_at: null,
    result: null,
    ...overrides,
  };
}

beforeEach(() => {
  resetMocks();
  delete process.env.MONEY_DUAL_APPROVAL_THRESHOLD_CENTS;
  dualApproval.setSettingsReader(async () => null);
  // Register a test executor (bypasses the rail executors module).
  dualApproval.registerMoneyMovementExecutor('job_refund', async ({ payload }) => ({
    ok: true,
    echo: payload,
  }));
});

function mockQuerySequence(handlers) {
  // handlers: array of (sql, params) => rows | { rows }
  let i = 0;
  mockQuery.mockImplementation(async (sql) => {
    const handler = handlers[Math.min(i, handlers.length - 1)];
    i += 1;
    const out = typeof handler === 'function' ? handler(sql) : handler;
    return Array.isArray(out) ? { rows: out } : out;
  });
}

describe('getDualApprovalThresholdCents', () => {
  test('defaults to 50000 ($500) when nothing is configured', async () => {
    expect(await dualApproval.getDualApprovalThresholdCents()).toBe(50000);
  });

  test('env var overrides the default', async () => {
    process.env.MONEY_DUAL_APPROVAL_THRESHOLD_CENTS = '100000';
    expect(await dualApproval.getDualApprovalThresholdCents()).toBe(100000);
  });

  test('invalid env var falls back to the default (fail-closed, never zero)', async () => {
    process.env.MONEY_DUAL_APPROVAL_THRESHOLD_CENTS = 'not-a-number';
    expect(await dualApproval.getDualApprovalThresholdCents()).toBe(50000);
    process.env.MONEY_DUAL_APPROVAL_THRESHOLD_CENTS = '0';
    expect(await dualApproval.getDualApprovalThresholdCents()).toBe(50000);
  });

  test('platform setting wins over env when valid', async () => {
    process.env.MONEY_DUAL_APPROVAL_THRESHOLD_CENTS = '100000';
    dualApproval.setSettingsReader(async () => '25000');
    expect(await dualApproval.getDualApprovalThresholdCents()).toBe(25000);
  });
});

describe('movementRequiresDualApproval', () => {
  test('below threshold does not require dual approval', async () => {
    expect(await dualApproval.movementRequiresDualApproval(49999)).toBe(false);
  });

  test('at threshold requires dual approval (boundary inclusive)', async () => {
    expect(await dualApproval.movementRequiresDualApproval(50000)).toBe(true);
  });
});

describe('requestMoneyMovementApproval', () => {
  test('below threshold returns { queued: false } without touching the DB', async () => {
    const result = await dualApproval.requestMoneyMovementApproval({
      movementType: 'job_refund',
      referenceKey: 'job:9',
      amountCents: 1000,
      requestedBy: MAKER,
      idempotencyKey: 'small-key-123',
      payload: {},
    });
    expect(result).toEqual({ queued: false });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('at/above threshold queues a pending approval', async () => {
    const row = approvalRow();
    mockQuerySequence([
      [], // SELECT existing -> none
      [row], // INSERT -> row
    ]);
    const result = await dualApproval.requestMoneyMovementApproval({
      movementType: 'job_refund',
      referenceKey: 'job:9',
      amountCents: 60000,
      requestedBy: MAKER,
      idempotencyKey: 'test-key-1',
      payload: { jobId: '9' },
    });
    expect(result.queued).toBe(true);
    expect(result.replay).toBe(false);
    expect(result.approval.status).toBe('pending');
    const insertSql = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO money_movement_approvals'))[0];
    expect(insertSql).toBeTruthy();
  });

  test('idempotency-key replay returns the existing approval (no duplicate)', async () => {
    const row = approvalRow();
    mockQuerySequence([[row]]); // SELECT existing -> row
    const result = await dualApproval.requestMoneyMovementApproval({
      movementType: 'job_refund',
      referenceKey: 'job:9',
      amountCents: 60000,
      requestedBy: MAKER,
      idempotencyKey: 'test-key-1',
      payload: { jobId: '9' },
    });
    expect(result.queued).toBe(true);
    expect(result.replay).toBe(true);
    expect(result.approval.id).toBe(42);
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('INSERT INTO'))).toBe(false);
  });

  test('idempotency-key reuse with different details is a 409 conflict', async () => {
    const row = approvalRow({ amount_cents: 60000 });
    mockQuerySequence([[row]]);
    await expect(dualApproval.requestMoneyMovementApproval({
      movementType: 'job_refund',
      referenceKey: 'job:9',
      amountCents: 99999, // different amount, same key
      requestedBy: MAKER,
      idempotencyKey: 'test-key-1',
      payload: {},
    })).rejects.toMatchObject({ status: 409 });
  });

  test('unknown movement type fails closed', async () => {
    await expect(dualApproval.requestMoneyMovementApproval({
      movementType: 'nope_not_a_rail',
      referenceKey: 'x:1',
      amountCents: 60000,
      requestedBy: MAKER,
      idempotencyKey: 'k-12345678',
      payload: {},
    })).rejects.toMatchObject({ status: 500 });
  });

  test('missing idempotency key is rejected', async () => {
    await expect(dualApproval.requestMoneyMovementApproval({
      movementType: 'job_refund',
      referenceKey: 'job:9',
      amountCents: 60000,
      requestedBy: MAKER,
      idempotencyKey: '',
      payload: {},
    })).rejects.toMatchObject({ status: 400 });
  });
});

describe('decideMoneyMovementApproval', () => {
  test('self-approval is forbidden (403)', async () => {
    mockQuerySequence([[approvalRow()]]);
    await expect(dualApproval.decideMoneyMovementApproval({
      approvalId: 42,
      approverId: MAKER, // same as requested_by
      decision: 'approve',
    })).rejects.toMatchObject({ status: 403, code: 'money_movement_self_approval' });
    // No UPDATE to executed may have happened.
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes("SET status = 'executed'"))).toBe(false);
  });

  test('approve runs the executor and flips to executed', async () => {
    const row = approvalRow();
    const executedRow = approvalRow({ status: 'executed' });
    mockQuerySequence([
      [row], // SELECT ... FOR UPDATE
      [executedRow], // UPDATE -> executed
    ]);
    const result = await dualApproval.decideMoneyMovementApproval({
      approvalId: 42,
      approverId: CHECKER,
      decision: 'approve',
    });
    expect(result.executed).toBe(true);
    expect(result.result).toEqual({ ok: true, echo: { jobId: '9' } });
    expect(result.approval.status).toBe('executed');
  });

  test('executor failure leaves the approval pending (fail-closed)', async () => {
    dualApproval.registerMoneyMovementExecutor('job_refund', async () => {
      throw new Error('stripe exploded');
    });
    mockQuerySequence([[approvalRow()]]);
    await expect(dualApproval.decideMoneyMovementApproval({
      approvalId: 42,
      approverId: CHECKER,
      decision: 'approve',
    })).rejects.toThrow('stripe exploded');
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes("SET status = 'executed'"))).toBe(false);
  });

  test('non-pending approvals cannot be decided twice (409)', async () => {
    mockQuerySequence([[approvalRow({ status: 'executed' })]]);
    await expect(dualApproval.decideMoneyMovementApproval({
      approvalId: 42,
      approverId: CHECKER,
      decision: 'approve',
    })).rejects.toMatchObject({ status: 409 });
  });

  test('reject flips to rejected with a reason', async () => {
    const row = approvalRow();
    const rejectedRow = approvalRow({ status: 'rejected', decided_by: CHECKER });
    mockQuerySequence([
      [row],
      [rejectedRow],
    ]);
    const result = await dualApproval.decideMoneyMovementApproval({
      approvalId: 42,
      approverId: CHECKER,
      decision: 'reject',
      reason: 'duplicate request',
    });
    expect(result.executed).toBe(false);
    expect(result.approval.status).toBe('rejected');
  });

  test('missing approval is a 404', async () => {
    mockQuerySequence([[]]);
    await expect(dualApproval.decideMoneyMovementApproval({
      approvalId: 999,
      approverId: CHECKER,
      decision: 'approve',
    })).rejects.toMatchObject({ status: 404 });
  });
});
