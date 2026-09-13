'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { createSettlement, reconcileCreditLedger, transitionSettlement, listAdminCustomerCreditAccounts } = require('../services/oxsteedCreditAdminService');

beforeEach(resetMocks);

test('lists bounded customer credit wallets with operator filters', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    account_id: 7001,
    customer_id: '11111111-1111-4111-8111-111111111111',
    email: 'alice@example.com',
    first_name: 'Alice',
    last_name: 'Customer',
    is_active: true,
    is_banned: false,
    currency_code: 'EUR',
    balance_cents: '12500',
    reserved_cents: '2500',
    status: 'suspended',
    ledger_version: '4',
    last_posted_at: '2026-09-12T12:00:00.000Z',
    updated_at: '2026-09-12T12:00:00.000Z',
  }] });

  const accounts = await listAdminCustomerCreditAccounts({ search: 'alice', currencyCode: 'EUR', status: 'suspended', limit: 10, offset: 20 });

  expect(accounts).toEqual([expect.objectContaining({
    accountId: '7001',
    customerId: '11111111-1111-4111-8111-111111111111',
    name: 'Alice Customer',
    availableBalanceCents: 10000,
    currencyCode: 'EUR',
    status: 'suspended',
  })]);
  expect(mockQuery.mock.calls[0][0]).toContain("a.account_type = 'customer_wallet'");
  expect(mockQuery.mock.calls[0][0]).toContain('u.email ILIKE');
  expect(mockQuery.mock.calls[0][0]).toContain('a.currency_code =');
  expect(mockQuery.mock.calls[0][0]).toContain('a.status =');
  expect(mockQuery.mock.calls[0][1]).toEqual(['%alice%', 'EUR', 'suspended', 10, 20]);
});

test('reconciliation uses the same posted-transaction currency invariant as verification', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{
      account_balance_cents: '1000',
      journal_balance_cents: '1000',
      difference_cents: '0',
      account_count: 1,
      entry_count: 2,
    }] })
    .mockResolvedValueOnce({ rows: [{
      id: 'run-1',
      currency_code: 'USD',
      period_start: '2026-09-11T00:00:00.000Z',
      period_end: '2026-09-12T00:00:00.000Z',
      status: 'balanced',
      account_balance_cents: '1000',
      journal_balance_cents: '1000',
      difference_cents: '0',
      account_count: 1,
      entry_count: 2,
      completed_at: '2026-09-12T02:00:00.000Z',
    }] })
    .mockResolvedValueOnce({ rows: [] });

  const result = await reconcileCreditLedger({
    currencyCode: 'USD',
    periodStart: '2026-09-11T00:00:00.000Z',
    periodEnd: '2026-09-12T00:00:00.000Z',
    actorUserId: null,
  });

  expect(result.run.status).toBe('balanced');
  expect(mockQuery.mock.calls[0][0]).toContain('JOIN oxsteed_credit_transactions');
  expect(mockQuery.mock.calls[0][0]).toContain("t.status = 'posted'");
  expect(mockQuery.mock.calls[0][0]).toContain("t.currency_code = $1");
  expect(mockQuery.mock.calls[0][1]).toEqual(['USD']);
});

test('serializes settlement creation per partner agreement before checking overlap', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{
      id: 'agreement-1',
      partner_id: 41,
      partner_status: 'active',
      restaurant_id: 9,
      restaurant_name: 'OxSteed Cafe',
      settlement_currency_code: 'USD',
    }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ gross_cents: '2500', refund_cents: '0', fee_cents: '0' }] })
    .mockResolvedValueOnce({ rows: [{
      id: 'settlement-1',
      partner_id: 41,
      agreement_id: 'agreement-1',
      currency_code: 'USD',
      period_start: '2026-09-01T00:00:00.000Z',
      period_end: '2026-09-02T00:00:00.000Z',
      gross_cents: '2500',
      refund_cents: '0',
      fee_cents: '0',
      net_cents: '2500',
      status: 'pending',
      payment_reference: null,
      metadata: {},
      created_at: '2026-09-02T00:00:00.000Z',
      updated_at: '2026-09-02T00:00:00.000Z',
    }] })
    .mockResolvedValueOnce({ rows: [] });

  const result = await createSettlement({
    partnerId: 41,
    agreementId: 'agreement-1',
    periodStart: '2026-09-01T00:00:00.000Z',
    periodEnd: '2026-09-02T00:00:00.000Z',
    idempotencyKey: 'settlement-1',
    actorUserId: null,
  });

  expect(result.settlement.id).toBe('settlement-1');
  expect(mockQuery.mock.calls[1][0]).toContain('pg_advisory_xact_lock');
  expect(mockQuery.mock.calls[1][1]).toEqual(['oxsteed-credit-settlement:41:agreement-1']);
  expect(mockQuery.mock.calls[2][0]).toContain('s.idempotency_key');
  expect(mockQuery.mock.calls[3][0]).toContain('period_start < $4');
});

test('rejects settlement idempotency reuse for a different period', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{
      id: 'agreement-1',
      partner_id: 41,
      partner_status: 'active',
      restaurant_id: 9,
      restaurant_name: 'OxSteed Cafe',
      settlement_currency_code: 'USD',
    }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{
      id: 'settlement-existing',
      partner_id: 41,
      agreement_id: 'agreement-1',
      period_start: '2026-09-01T00:00:00.000Z',
      period_end: '2026-09-02T00:00:00.000Z',
    }] });

  await expect(createSettlement({
    partnerId: 41,
    agreementId: 'agreement-1',
    periodStart: '2026-09-02T00:00:00.000Z',
    periodEnd: '2026-09-03T00:00:00.000Z',
    idempotencyKey: 'settlement-existing-key',
  })).rejects.toMatchObject({ code: 'credit_settlement_idempotency_conflict' });
});

test('rejects settlement periods that end in the future', async () => {
  await expect(createSettlement({
    partnerId: 41,
    agreementId: 'agreement-1',
    periodStart: '2099-09-01T00:00:00.000Z',
    periodEnd: '2099-09-02T00:00:00.000Z',
    idempotencyKey: 'settlement-future-key',
  })).rejects.toMatchObject({ code: 'credit_settlement_period_future' });
  expect(mockQuery).not.toHaveBeenCalled();
});

test('requires a payment reference before paying a non-zero settlement', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'settlement-approved',
    partner_id: 41,
    partner_status: 'active',
    restaurant_id: 9,
    restaurant_name: 'OxSteed Cafe',
    currency_code: 'USD',
    net_cents: '2500',
    status: 'approved',
    payment_reference: null,
  }] });

  await expect(transitionSettlement({
    settlementId: 'settlement-approved',
    targetStatus: 'paid',
    actorUserId: 'admin-1',
  })).rejects.toMatchObject({ code: 'credit_settlement_payment_reference_required' });
  expect(mockQuery).toHaveBeenCalledTimes(1);
});
