'use strict';

/**
 * Tests for the fiat funding compliance choke point
 * (server/services/fiatComplianceService.js). The DB is the shared pg mock
 * from ./setup (mockQuery); withTransaction is mocked to run against
 * pool.query, so tests queue mock responses linearly.
 */

const { mockQuery, resetMocks } = require('./setup');
const { evaluateFundingCompliance, COMPLIANCE_ACTION_TYPE } = require('../services/fiatComplianceService');

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(resetMocks);

function mockHealthyRail() {
  mockQuery.mockImplementation(async (text) => {
    const sql = String(text);
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (sql.includes("FROM feature_flags WHERE key = 'oxsteed_credit_enabled'")) return { rows: [{ is_enabled: true }] };
    if (sql.includes('FROM oxsteed_credit_accounts')) return { rows: [{ total_cents: '0' }] };
    if (sql.includes('FROM oxsteed_credit_transactions')) return { rows: [{ total_cents: '0' }] };
    if (sql.includes('INSERT INTO oxsteed_credit_audit_events')) return { rows: [] };
    return { rows: [], rowCount: 0 };
  });
}

test('passes for a valid small amount and writes the compliance audit event', async () => {
  mockHealthyRail();

  const result = await evaluateFundingCompliance({
    customerId: CUSTOMER_ID,
    amountCents: 1000,
    currencyCode: 'USD',
    fundingMethod: 'stripe_topup',
    actorUserId: CUSTOMER_ID,
    requestIp: '127.0.0.1',
    correlationId: 'corr-1',
  });

  expect(result.allowed).toBe(true);
  expect(result.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(COMPLIANCE_ACTION_TYPE).toBe('fiat.funding_compliance_evaluated');

  const auditCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO oxsteed_credit_audit_events'));
  expect(auditCall).toBeTruthy();
  expect(auditCall[1][0]).toBe('fiat.funding_compliance_evaluated');
});

test('fails closed with 503 credit_rail_suspended when the rail is disabled', async () => {
  mockQuery.mockImplementation(async (text) => {
    const sql = String(text);
    if (sql.includes("FROM feature_flags WHERE key = 'oxsteed_credit_enabled'")) return { rows: [{ is_enabled: false }] };
    return { rows: [], rowCount: 0 };
  });

  await expect(evaluateFundingCompliance({
    customerId: CUSTOMER_ID,
    amountCents: 1000,
    currencyCode: 'USD',
    fundingMethod: 'stripe_topup',
  })).rejects.toMatchObject({ code: 'credit_rail_suspended', status: 503 });
});

test('rejects an amount over MAX_TRANSACTION_CENTS with 402', async () => {
  mockHealthyRail();

  await expect(evaluateFundingCompliance({
    customerId: CUSTOMER_ID,
    amountCents: 250001,
    currencyCode: 'USD',
    fundingMethod: 'stripe_topup',
  })).rejects.toMatchObject({ code: 'fiat_compliance_amount_limit', status: 402 });
});

test('rejects a non-positive amount with 400', async () => {
  mockHealthyRail();

  await expect(evaluateFundingCompliance({
    customerId: CUSTOMER_ID,
    amountCents: 0,
    currencyCode: 'USD',
    fundingMethod: 'stripe_topup',
  })).rejects.toMatchObject({ code: 'fiat_compliance_amount_invalid', status: 400 });
});

test('rejects a missing customer with 400 before touching the database', async () => {
  await expect(evaluateFundingCompliance({
    amountCents: 100,
    currencyCode: 'USD',
    fundingMethod: 'stripe_topup',
  })).rejects.toMatchObject({ code: 'fiat_compliance_customer_required', status: 400 });
  expect(mockQuery).not.toHaveBeenCalled();
});

test('rejects a missing funding method with 400', async () => {
  await expect(evaluateFundingCompliance({
    customerId: CUSTOMER_ID,
    amountCents: 100,
    currencyCode: 'USD',
  })).rejects.toMatchObject({ code: 'fiat_compliance_method_required', status: 400 });
  expect(mockQuery).not.toHaveBeenCalled();
});
