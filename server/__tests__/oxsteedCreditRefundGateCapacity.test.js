'use strict';

/**
 * Part B of the item 43 refund gate: the real evaluateFundingCompliance
 * with skipIssuanceCapacity set must not call the capacity check at all,
 * so a customer near an issuance cap is not blocked on a refund, while
 * sanctions + identity-tier checks still run and the skip is recorded in
 * the pass audit metadata. Without the flag, the same capacity breach
 * must still deny.
 *
 * Helper modules are mocked; the gate function itself is real.
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/oxsteedCreditService', () => {
  const actual = jest.requireActual('../services/oxsteedCreditService');
  return {
    ...actual,
    assertCreditRailEnabled: jest.fn().mockResolvedValue(undefined),
    assertIssuanceCapacity: jest.fn(),
  };
});
jest.mock('../services/identityVerificationService', () => ({
  assertIdentityVerificationTier: jest.fn().mockResolvedValue({ tier: 2 }),
}));
jest.mock('../services/sanctionsScreeningService', () => ({
  assertSanctionsClear: jest.fn().mockResolvedValue({ cleared: true }),
}));

const { evaluateFundingCompliance } = require('../services/fiatComplianceService');
const creditService = require('../services/oxsteedCreditService');
const identityService = require('../services/identityVerificationService');
const sanctionsService = require('../services/sanctionsScreeningService');

function capacityError() {
  return Object.assign(new Error('OxSteed Credit issuance limit reached'), {
    status: 409,
    code: 'credit_total_issuance_limit',
  });
}

function installRouter() {
  mockQuery.mockImplementation((sql) => {
    const s = String(sql);
    if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
    return { rows: [] };
  });
}

function refundGateArgs(overrides = {}) {
  return {
    customerId: 'cust-9',
    amountCents: 5000,
    currencyCode: 'USD',
    fundingMethod: 'admin_refund',
    actorUserId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    ...overrides,
  };
}

beforeEach(() => {
  resetMocks();
  installRouter();
  creditService.assertIssuanceCapacity.mockReset();
  identityService.assertIdentityVerificationTier.mockReset().mockResolvedValue({ tier: 2 });
  sanctionsService.assertSanctionsClear.mockReset().mockResolvedValue({ cleared: true });
});

describe('evaluateFundingCompliance skipIssuanceCapacity', () => {
  test('without the flag, a capacity breach denies the refund', async () => {
    creditService.assertIssuanceCapacity.mockRejectedValueOnce(capacityError());
    await expect(evaluateFundingCompliance(refundGateArgs())).rejects.toMatchObject({
      status: 409,
      code: 'credit_total_issuance_limit',
    });
    expect(creditService.assertIssuanceCapacity).toHaveBeenCalledTimes(1);
  });

  test('with the flag, a capacity breach does not block and the skip is audited', async () => {
    creditService.assertIssuanceCapacity.mockRejectedValue(capacityError());
    const result = await evaluateFundingCompliance(refundGateArgs({ skipIssuanceCapacity: true }));
    expect(result.allowed).toBe(true);
    expect(creditService.assertIssuanceCapacity).not.toHaveBeenCalled();
    expect(identityService.assertIdentityVerificationTier).toHaveBeenCalledTimes(1);
    expect(sanctionsService.assertSanctionsClear).toHaveBeenCalledTimes(1);
    const auditCall = mockQuery.mock.calls.find(
      ([sql]) => String(sql).includes('INSERT INTO oxsteed_credit_audit_events')
    );
    expect(auditCall).toBeTruthy();
    const metadata = JSON.parse(auditCall[1][9]);
    expect(metadata.issuanceCapacitySkipped).toBe(true);
    expect(metadata.fundingMethod).toBe('admin_refund');
  });
});
