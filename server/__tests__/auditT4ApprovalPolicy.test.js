'use strict';

/**
 * Audit T4 (item 19) — approvalRequirement fails closed on unknown actions.
 *
 * DEFAULT_POS_APPROVAL_POLICY had no 'discount' key and unknown actions
 * yielded {} -> { required: false }, so any money action wired through
 * consumeManagerApproval with an unconfigured name silently skipped
 * manager approval. Unknown actions now default to { always: true }, and
 * 'discount' is an explicit always-require entry.
 */

const { mockQuery, resetMocks } = require('./setup');
const {
  approvalRequirement,
  DEFAULT_POS_APPROVAL_POLICY,
} = require('../services/restaurantStaffIdentityService');

beforeEach(() => {
  resetMocks();
  mockQuery.mockResolvedValue({ rows: [{}] });
});

const noSettings = { settings: {} };

describe('item 19: unknown actions fail closed', () => {
  test('an unknown action requires manager approval at any amount', () => {
    const r = approvalRequirement(noSettings, 'some_future_money_action', 0);
    expect(r.required).toBe(true);
    expect(r.always).toBe(true);
  });

  test('an unknown action requires approval even for large amounts', () => {
    expect(approvalRequirement(noSettings, 'gift_card_cash_out', 999999).required).toBe(true);
  });

  test('discount is an explicit always-require entry', () => {
    expect(DEFAULT_POS_APPROVAL_POLICY.discount).toEqual({ always: true });
    expect(approvalRequirement(noSettings, 'discount', 0).required).toBe(true);
  });

  test('null/undefined settings still fail closed for unknown actions', () => {
    expect(approvalRequirement(null, 'mystery_action', 0).required).toBe(true);
    expect(approvalRequirement({}, 'mystery_action', 0).required).toBe(true);
  });
});

describe('item 19: known actions keep their existing semantics', () => {
  test('void/refund/no_sale always require approval', () => {
    expect(approvalRequirement(noSettings, 'void', 0).required).toBe(true);
    expect(approvalRequirement(noSettings, 'refund', 1).required).toBe(true);
    expect(approvalRequirement(noSettings, 'no_sale', 0).required).toBe(true);
  });

  test('payout honors its threshold', () => {
    expect(approvalRequirement(noSettings, 'payout', 9999).required).toBe(false);
    expect(approvalRequirement(noSettings, 'payout', 10001).required).toBe(true);
  });

  test('comp honors its threshold', () => {
    expect(approvalRequirement(noSettings, 'comp', 2499).required).toBe(false);
    expect(approvalRequirement(noSettings, 'comp', 2501).required).toBe(true);
  });

  test('an explicit restaurant override is still honored for a known action', () => {
    const restaurant = { settings: { posApprovalPolicy: { comp: { thresholdCents: null } } } };
    expect(approvalRequirement(restaurant, 'comp', 999999).required).toBe(false);
  });

  test('an explicit restaurant override can set a policy for a new action name', () => {
    const restaurant = {
      settings: { posApprovalPolicy: { gift_card_cash_out: { thresholdCents: 5000 } } },
    };
    expect(approvalRequirement(restaurant, 'gift_card_cash_out', 4999).required).toBe(false);
    expect(approvalRequirement(restaurant, 'gift_card_cash_out', 5001).required).toBe(true);
  });
});
