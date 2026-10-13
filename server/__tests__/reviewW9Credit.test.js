'use strict';

const { mockQuery, resetMocks } = require('./setup');
const fs = require('fs');
const path = require('path');

function route(handlers) {
  mockQuery.mockImplementation(async (sql, params) => {
    const text = String(sql);
    for (const [re, fn] of handlers) {
      if (re.test(text)) return typeof fn === 'function' ? fn(text, params) : fn;
    }
    return { rows: [], rowCount: 0 };
  });
}

describe('review W9: OxSteed Credit settlement and maker-checker fixes', () => {
  beforeEach(() => resetMocks());

  const baseSettlement = {
    id: '11111111-1111-4111-8111-111111111111', status: 'approved', payout_status: 'initiated',
    partner_status: 'active', net_cents: 1000, approved_by: 'a1', partner_id: 'p1', currency_code: 'USD',
  };

  test.each(['voided', 'disputed', 'paid'])('P1-248/P1-254: %s is refused while a Stripe payout is in flight', async (target) => {
    route([[/FROM oxsteed_credit_settlements s/, { rows: [baseSettlement] }]]);
    const { transitionSettlement } = require('../services/oxsteedCreditAdminService');
    await expect(transitionSettlement({
      settlementId: baseSettlement.id, targetStatus: target, actorUserId: '00000000-0000-4000-8000-000000000001',
      reason: 'test', paymentReference: 'ref-1',
    })).rejects.toMatchObject({ code: 'credit_settlement_payout_in_flight', statusCode: 409 });
  });

  test('P1-247: manual mark-paid routes through maker-checker', () => {
    const src = fs.readFileSync(path.join(__dirname, '../controllers/oxsteedCreditController.js'), 'utf8');
    expect(src).toMatch(/targetStatus === 'approved' \|\| targetStatus === 'paid'/);
  });

  test('P1-253: sweeper expires past-deadline pending actions', async () => {
    route([[/UPDATE oxsteed_credit_pending_actions/, { rows: [{ id: 7, action_type: 'credit_settlement_approval' }] }]]);
    const { expireStalePendingActions } = require('../services/oxsteedCreditPendingActionService');
    await expect(expireStalePendingActions()).resolves.toEqual({ expired: 1 });
    const update = mockQuery.mock.calls.find(([sql]) => /UPDATE oxsteed_credit_pending_actions/.test(sql))[0];
    expect(update).toMatch(/expires_at < NOW\(\)/);
  });

  test('P1-253: pending list excludes past-deadline rows', async () => {
    route([[/FROM oxsteed_credit_pending_actions/, { rows: [] }]]);
    const { listPendingActions } = require('../services/oxsteedCreditPendingActionService');
    await listPendingActions({ status: 'pending' });
    expect(mockQuery.mock.calls[0][0]).toMatch(/expires_at IS NULL OR expires_at >= NOW\(\)/);
  });

  test('P1-251: self-approval is forbidden when the break-glass flag is off', async () => {
    route([
      [/FROM feature_flags WHERE key = 'credit_single_admin_self_approval'/, { rows: [{ is_enabled: false }] }],
      [/feature_flags/, { rows: [{ is_enabled: true }] }],
      [/oxsteed_credit_rail_freezes/, { rows: [] }],
      [/FROM oxsteed_credit_pending_actions/, { rows: [{ id: 1, status: 'pending', requested_by: 'u1', action_type: 'credit_settlement_approval', payload: {}, expires_at: null }] }],
    ]);
    const { decidePendingAction } = require('../services/oxsteedCreditPendingActionService');
    await expect(decidePendingAction({ actionId: 1, id: 1, decision: 'approved', decidedBy: 'u1', reason: 'only admin' }))
      .rejects.toMatchObject({ code: 'credit_self_approval_forbidden' });
  });

  test('P1-251: no env setting re-enables self-approval', async () => {
    process.env.CREDIT_SINGLE_ADMIN_BREAK_GLASS = 'true';
    try {
      route([
        [/FROM feature_flags WHERE key = 'credit_single_admin_self_approval'/, { rows: [{ is_enabled: false }] }],
        [/feature_flags/, { rows: [{ is_enabled: true }] }],
        [/oxsteed_credit_rail_freezes/, { rows: [] }],
        [/FROM users/, { rows: [{ n: 1 }] }],
        [/FROM oxsteed_credit_pending_actions/, { rows: [{ id: 1, status: 'pending', requested_by: 'u1', action_type: 'credit_settlement_mark_paid', payload: {}, expires_at: null }] }],
      ]);
      const { decidePendingAction } = require('../services/oxsteedCreditPendingActionService');
      await expect(decidePendingAction({ actionId: 1, id: 1, decision: 'approved', decidedBy: 'u1', reason: 'only admin' }))
        .rejects.toMatchObject({ code: 'credit_self_approval_forbidden' });
    } finally {
      delete process.env.CREDIT_SINGLE_ADMIN_BREAK_GLASS;
    }
    const src = fs.readFileSync(path.join(__dirname, '../services/oxsteedCreditPendingActionService.js'), 'utf8');
    expect(src).not.toMatch(/BREAK_GLASS|break_glass_self_approval/);
  });

  test('P1-9-F05: break-glass needs the DB flag on AND fewer than 2 super admins', async () => {
    // Flag on but a second super admin exists: the two-person rule stands.
    route([
      [/FROM feature_flags WHERE key = 'credit_single_admin_self_approval'/, { rows: [{ is_enabled: true }] }],
      [/feature_flags/, { rows: [{ is_enabled: true }] }],
      [/oxsteed_credit_rail_freezes/, { rows: [] }],
      [/FROM users/, { rows: [{ n: 2 }] }],
      [/FROM oxsteed_credit_pending_actions/, { rows: [{ id: 1, status: 'pending', requested_by: 'u1', action_type: 'credit_settlement_approval', payload: {}, expires_at: null }] }],
    ]);
    const { decidePendingAction } = require('../services/oxsteedCreditPendingActionService');
    await expect(decidePendingAction({ actionId: 1, id: 1, decision: 'approved', decidedBy: 'u1', reason: 'only admin' }))
      .rejects.toMatchObject({ code: 'credit_self_approval_forbidden' });
  });

  test('P1-250: daily cap check takes a per-proposer lock', () => {
    const src = fs.readFileSync(path.join(__dirname, '../controllers/agentCreditAdjustmentController.js'), 'utf8');
    expect(src).toMatch(/agent-credit-adjustment-cap:\$\{proposedBy\}/);
    expect(src).toMatch(/WITH cap_lock AS \(SELECT pg_advisory_xact_lock/);
  });

  test('P1-249: replay skips the sweep while the rail is frozen', async () => {
    route([
      [/feature_flags/, { rows: [{ is_enabled: true }] }],
      [/oxsteed_credit_rail_freezes/, { rows: [{ id: 1, reason: 'x', frozen_at: new Date() }] }],
    ]);
    const { replayDualPostingBackfill } = require('../services/oxsteedCreditSubBankService');
    await expect(replayDualPostingBackfill({ query: mockQuery, connect: async () => ({ query: mockQuery, release() {} }) }))
      .resolves.toMatchObject({ skipped: 'rail_frozen' });
    expect(mockQuery.mock.calls.some(([sql]) => /FROM credit_dual_posting_backfill/.test(sql))).toBe(false);
  });

  test('P1-255: refund rows wait for their redemption row', async () => {
    const refundRow = { id: 9, ledger_entry_id: 50, entry_type: 'refund', attempts: 0, metadata: { originalDebitEntryId: 40 } };
    route([
      [/feature_flags/, { rows: [{ is_enabled: true }] }],
      [/oxsteed_credit_rail_freezes/, { rows: [] }],
      [/WHERE status = 'pending'/, { rows: [refundRow] }],
      [/status <> 'processed'/, { rows: [{ status: 'failed' }] }],
    ]);
    const { replayDualPostingBackfill } = require('../services/oxsteedCreditSubBankService');
    const result = await replayDualPostingBackfill({ query: mockQuery, connect: async () => ({ query: mockQuery, release() {} }) });
    expect(result).toMatchObject({ replayed: 0, deferred: 1, parked: 0 });
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE credit_dual_posting_backfill/.test(sql))).toBe(false);
  });

  test('P1-249: parked rows can be requeued', async () => {
    route([[/UPDATE credit_dual_posting_backfill/, { rows: [], rowCount: 2 }]]);
    const { requeueParkedDualPostingBackfill } = require('../services/oxsteedCreditSubBankService');
    await expect(requeueParkedDualPostingBackfill({ query: mockQuery }, { ids: ['1', '2'] })).resolves.toEqual({ requeued: 2 });
  });

  test('P1-252: housekeeping raises aging/parked incidents', async () => {
    jest.isolateModules(() => {});
    const incidentStore = require('../services/incidentStore');
    const spy = jest.spyOn(incidentStore, 'recordIncident').mockResolvedValue({ id: 1 });
    route([
      [/UPDATE oxsteed_credit_pending_actions/, { rows: [] }],
      [/FROM oxsteed_credit_settlements/, { rows: [{ id: 's1' }] }],
      [/FROM credit_dual_posting_backfill/, { rows: [{ n: 3 }] }],
    ]);
    const { runOxsteedCreditHousekeeping } = require('../jobs/oxsteedCreditHousekeeping');
    const result = await runOxsteedCreditHousekeeping({ query: mockQuery });
    expect(result).toEqual({ expired: 0, agingSettlements: 1, parkedBackfill: 3 });
    expect(spy.mock.calls.map(([arg]) => arg.type)).toEqual(['oxsteed_credit_settlement_pending_aging', 'oxsteed_credit_backfill_parked']);
    spy.mockRestore();
  });
});

describe('review W9: food pay_now orders', () => {
  beforeEach(() => resetMocks());

  test('P1-236: abandoned pay_now orders are cancelled after the grace window', async () => {
    route([[/UPDATE food_orders/, { rows: [{ id: 5, restaurant_id: 1 }] }]]);
    const { cancelAbandonedPayNowOrders } = require('../services/foodAbandonedOrderSweeper');
    await expect(cancelAbandonedPayNowOrders({ query: mockQuery })).resolves.toEqual({ cancelled: 1, orderIds: [5] });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/payment_status = 'requires_payment'/);
    expect(sql).toMatch(/'pay_now'/);
    expect(params).toEqual([25]);
  });

  test('P1-236: kitchen feed and status gate exclude unpaid pay_now orders', () => {
    const src = fs.readFileSync(path.join(__dirname, '../controllers/foodController.js'), 'utf8');
    expect(src).toMatch(/order_payment_pending/);
    expect((src.match(/Review P1-236: unpaid pay_now checkouts are not kitchen work yet/g) || []).length).toBe(2);
  });

  test('P1-237: dead payment PATCH endpoint is removed', () => {
    const routes = fs.readFileSync(path.join(__dirname, '../routes/food.js'), 'utf8');
    const ctrl = require('../controllers/foodController');
    expect(routes).not.toMatch(/orders\/:orderId\/payment'/);
    expect(ctrl.updateOrderPayment).toBeUndefined();
  });
});
