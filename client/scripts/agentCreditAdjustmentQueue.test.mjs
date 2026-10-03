import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_ADJUSTMENT_ENDPOINTS,
  canCancelAdjustment,
  canDecideAdjustment,
  isOwnProposal,
  signedAmountLabel,
} from '../src/admin/pages/super/oxsteedCredit/agentAdjustmentQueue.js';

const PROPOSER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_ADMIN_ID = '22222222-2222-2222-2222-222222222222';

const pendingAdjustment = (overrides = {}) => ({
  id: '33333333-3333-3333-3333-333333333333',
  proposedBy: PROPOSER_ID,
  amountCents: 7500,
  status: 'pending',
  ...overrides,
});

test('isOwnProposal matches the proposer by identity, not by role', () => {
  assert.equal(isOwnProposal(pendingAdjustment(), PROPOSER_ID), true);
  assert.equal(isOwnProposal(pendingAdjustment(), OTHER_ADMIN_ID), false);
  assert.equal(isOwnProposal(pendingAdjustment(), null), false);
  assert.equal(isOwnProposal(pendingAdjustment(), ''), false);
});

test('canDecideAdjustment is false for the proposer so they never see Approve/Reject', () => {
  assert.equal(canDecideAdjustment(pendingAdjustment(), PROPOSER_ID), false);
  assert.equal(canDecideAdjustment(pendingAdjustment(), OTHER_ADMIN_ID), true);
});

test('canDecideAdjustment is false without a known admin identity', () => {
  assert.equal(canDecideAdjustment(pendingAdjustment(), null), false);
  assert.equal(canDecideAdjustment(pendingAdjustment(), undefined), false);
});

test('canCancelAdjustment is true only for the proposer (withdraw own proposal)', () => {
  assert.equal(canCancelAdjustment(pendingAdjustment(), PROPOSER_ID), true);
  assert.equal(canCancelAdjustment(pendingAdjustment(), OTHER_ADMIN_ID), false);
  assert.equal(canCancelAdjustment(pendingAdjustment(), null), false);
});

test('endpoint builders produce the agent credit-adjustment paths', () => {
  const id = '44444444-4444-4444-4444-444444444444';
  assert.equal(AGENT_ADJUSTMENT_ENDPOINTS.pending, '/api/agent/credit-adjustments/pending');
  assert.equal(AGENT_ADJUSTMENT_ENDPOINTS.approve(id), `/api/agent/credit-adjustments/${id}/approve`);
  assert.equal(AGENT_ADJUSTMENT_ENDPOINTS.reject(id), `/api/agent/credit-adjustments/${id}/reject`);
  assert.equal(AGENT_ADJUSTMENT_ENDPOINTS.cancel(id), `/api/agent/credit-adjustments/${id}/cancel`);
});

test('signedAmountLabel prefixes the sign outside the formatted money', () => {
  const fakeMoney = (cents) => `$${(cents / 100).toFixed(2)}`;
  assert.equal(signedAmountLabel(7500, fakeMoney), '+$75.00');
  assert.equal(signedAmountLabel(-2000, fakeMoney), '-$20.00');
  assert.equal(signedAmountLabel(0, fakeMoney), '+$0.00');
});
