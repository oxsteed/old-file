'use strict';
const { mockQuery, resetMocks } = require('./setup');
jest.unmock('../utils/transaction');
jest.mock('../services/stepupChallengeService', () => ({ verifyStepupChallenge: jest.fn().mockResolvedValue({ verified: true }) }));
const { requestPendingAction, decidePendingAction } = require('../services/oxsteedCreditPendingActionService');
const { transitionSettlement } = require('../services/oxsteedCreditAdminService');
let enabled; let frozen; let flagError; let paymentReference; let changeAtExecution;
const maker = '00000000-0000-4000-8000-000000000001';
const checker = '00000000-0000-4000-8000-000000000002';
const id = '00000000-0000-4000-8000-000000000003';
function pending() { return { id, status: 'pending', action_type: 'credit_settlement_approval', requested_by: maker,
  expires_at: new Date(Date.now() + 3600000).toISOString(), payload: { settlementId: id, targetStatus: 'paid', expectedStatus: 'approved',
    paymentReference, reason: 'Synthetic payment reconciliation' } }; }
function route() {
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM feature_flags/.test(sql)) { if (flagError) throw new Error('synthetic flag outage'); return { rows: [{ is_enabled: enabled }] }; }
    if (/FROM oxsteed_credit_rail_freezes/.test(sql)) return { rows: frozen ? [{ id: 2 }] : [] };
    if (/INSERT INTO oxsteed_credit_pending_actions|FROM oxsteed_credit_pending_actions/.test(sql)) {
      if (/FOR UPDATE/.test(sql) && changeAtExecution) { changeAtExecution(); changeAtExecution = null; }
      return { rows: [pending()] };
    }
    if (/SELECT net_cents/.test(sql)) return { rows: [{ net_cents: '0' }] };
    if (/FROM oxsteed_credit_settlements s/.test(sql)) return { rows: [{ id, partner_id: 1, partner_status: 'active', status: 'approved',
      currency_code: 'USD', net_cents: '0', approved_by: maker, payment_reference: null }] };
    if (/UPDATE oxsteed_credit_settlements/.test(sql)) return { rows: [{ id, status: 'paid', net_cents: '0', payment_reference: paymentReference }] };
    return { rows: [] };
  });
}
function decide(decidedBy = checker) { return decidePendingAction({ actionId: id, decidedBy, decision: 'approved', stepupChallengeId: id, stepupCode: 'synthetic' }); }
beforeEach(() => { resetMocks(); enabled = true; frozen = false; flagError = false; changeAtExecution = null; paymentReference = 'bank:reference-1'; route(); });
test.each([
  ['disabled after request', () => { enabled = false; }, 'credit_rail_suspended'],
  ['frozen after request', () => { frozen = true; }, 'credit_rail_frozen'],
  ['unreadable after request', () => { flagError = true; }, 'credit_rail_status_unavailable'],
])('%s blocks mark-paid at execution', async (_name, change, code) => {
  await requestPendingAction({ actionType: 'credit_settlement_approval', payload: pending().payload, requestedBy: maker, idempotencyKey: 'synthetic-settlement-request' });
  mockQuery.mockClear(); changeAtExecution = change;
  await expect(decide()).rejects.toMatchObject({ code });
  expect(mockQuery.mock.calls.some(([sql]) => /UPDATE oxsteed_credit_settlements|SET status = 'approved'/.test(sql))).toBe(false);
  expect(mockQuery).toHaveBeenCalledWith('ROLLBACK');
});
test('a distinct checker can execute a valid reference while the rail is enabled', async () => {
  await expect(decide()).resolves.toMatchObject({ result: { settlement: { status: 'paid' } } });
  expect(mockQuery.mock.calls.some(([sql]) => /UPDATE oxsteed_credit_settlements/.test(sql))).toBe(true);
});
test('the maker cannot approve their own payment', async () => {
  await expect(decide(maker)).rejects.toMatchObject({ code: 'credit_self_approval_forbidden' });
  expect(mockQuery.mock.calls.some(([sql]) => /UPDATE oxsteed_credit_settlements/.test(sql))).toBe(false);
});
test.each(['bad reference!', 'x', 'ref\nwith\nlines'])('invalid payment reference %j cannot reach the ledger', async (value) => {
  paymentReference = value;
  await expect(decide()).rejects.toMatchObject({ code: 'credit_settlement_payment_reference_invalid' });
  expect(mockQuery.mock.calls.some(([sql]) => /UPDATE oxsteed_credit_settlements/.test(sql))).toBe(false);
});
test('a non-zero settlement requires a payment reference', async () => {
  mockQuery.mockResolvedValue({ rows: [{ id, status: 'approved', partner_status: 'active', net_cents: '100', approved_by: maker }] });
  await expect(transitionSettlement({ settlementId: id, targetStatus: 'paid', actorUserId: checker, reason: 'Synthetic evidence' }))
    .rejects.toMatchObject({ code: 'credit_settlement_payment_reference_required' });
});
