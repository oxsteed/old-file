'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { createSettlement, reconcileCreditLedger, transitionSettlement, transitionAgreement, listAdminCustomerCreditAccounts, getAdminCustomerCreditAccount, listEntitlements, upsertEntitlement, createAgreement } = require('../services/oxsteedCreditAdminService');

beforeEach(resetMocks);

test('lists bounded customer credit wallets with operator filters', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    total: 1,
  }] });
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

  const result = await listAdminCustomerCreditAccounts({ search: 'alice', currencyCode: 'EUR', status: 'suspended', limit: 10, offset: 20 });

  expect(result).toMatchObject({ total: 1, limit: 10, offset: 20, hasMore: false });
  expect(result.accounts).toEqual([expect.objectContaining({
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
  expect(mockQuery.mock.calls[0][1]).toEqual(['%alice%', 'EUR', 'suspended']);
  expect(mockQuery.mock.calls[1][0]).toContain('LIMIT $4 OFFSET $5');
  expect(mockQuery.mock.calls[1][1]).toEqual(['%alice%', 'EUR', 'suspended', 10, 20]);
});

test('does not grant a Credit entitlement to a non-customer identity', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 'agreement-1', partner_id: 41 }] })
    .mockResolvedValueOnce({ rows: [] });

  await expect(upsertEntitlement({
    agreementId: 'agreement-1',
    customerId: '33333333-3333-4333-8333-333333333333',
    reason: 'Partner-specific access',
  })).rejects.toMatchObject({ code: 'customer_not_found', status: 404 });

  expect(mockQuery.mock.calls[1][0]).toContain("role = 'customer'");
});

test('lists customer entitlements with restaurant context and bounded paging', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'entitlement-1',
    customer_id: '11111111-1111-4111-8111-111111111111',
    first_name: 'Alice',
    last_name: 'Customer',
    email: 'alice@example.com',
    agreement_id: 'agreement-1',
    partner_id: 41,
    restaurant_id: 9,
    restaurant_name: 'OxSteed Cafe',
    agreement_version: 2,
    agreement_status: 'active',
    settlement_currency_code: 'USD',
    status: 'active',
    starts_at: null,
    ends_at: null,
    max_transaction_cents: '2500',
    daily_limit_cents: '10000',
    reason: 'Partner-specific access',
    metadata: {},
    created_by: null,
    created_at: '2026-09-12T12:00:00.000Z',
    updated_at: '2026-09-12T12:00:00.000Z',
    total_count: 21,
  }] });

  const result = await listEntitlements({ search: 'alice', customerId: '11111111-1111-4111-8111-111111111111', status: 'active', limit: 10, offset: 20 });

  expect(result).toMatchObject({ total: 21, limit: 10, offset: 20, hasMore: false });
  expect(result.entitlements[0]).toMatchObject({
    customerName: 'Alice Customer',
    customerEmail: 'alice@example.com',
    restaurantName: 'OxSteed Cafe',
    agreementVersion: 2,
    currencyCode: 'USD',
    maxTransactionCents: 2500,
  });
  expect(mockQuery.mock.calls[0][0]).toContain('JOIN food_restaurants fr');
  expect(mockQuery.mock.calls[0][0]).toContain('u.email ILIKE');
  expect(mockQuery.mock.calls[0][0]).toContain("u.role = 'customer'");
  expect(mockQuery.mock.calls[0][0]).toContain('e.customer_id = $2');
  expect(mockQuery.mock.calls[0][0]).toContain('e.status = $3');
  expect(mockQuery.mock.calls[0][1]).toEqual(['%alice%', '11111111-1111-4111-8111-111111111111', 'active', 10, 20]);
});

test('loads a customer Credit profile with multi-restaurant access and ledger context', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{
      account_id: 7001,
      customer_id: '11111111-1111-4111-8111-111111111111',
      email: 'alice@example.com',
      first_name: 'Alice',
      last_name: 'Customer',
      is_active: true,
      is_banned: false,
      currency_code: 'USD',
      balance_cents: '12500',
      reserved_cents: '2500',
      status: 'active',
      ledger_version: '4',
      last_posted_at: '2026-09-12T12:00:00.000Z',
      updated_at: '2026-09-12T12:00:00.000Z',
    }] })
    .mockResolvedValueOnce({ rows: [{
      id: 'transaction-1',
      transaction_type: 'purchase',
      status: 'posted',
      amount_cents: '2500',
      currency_code: 'USD',
      direction: 'debit',
      partner_id: 41,
      agreement_id: 'agreement-1',
      restaurant_name: 'OxSteed Cafe',
      reference_type: 'food_order',
      reference_id: '123',
      description: 'Lunch',
      actor_type: 'customer',
      actor_user_id: null,
      metadata: {},
      posted_at: '2026-09-12T12:00:00.000Z',
      created_at: '2026-09-12T12:00:00.000Z',
    }] })
    .mockResolvedValueOnce({ rows: [{
      id: 'hold-1',
      customer_id: '11111111-1111-4111-8111-111111111111',
      partner_id: 42,
      restaurant_id: 10,
      restaurant_name: 'OxSteed Bistro',
      agreement_id: 'agreement-2',
      amount_cents: '1000',
      currency_code: 'USD',
      status: 'active',
      purpose: 'Dinner',
      reference_type: 'food_order',
      reference_id: 'order-2',
      captured_transaction_id: null,
      expires_at: '2026-09-12T12:30:00.000Z',
      captured_at: null,
      released_at: null,
      created_at: '2026-09-12T12:00:00.000Z',
      updated_at: '2026-09-12T12:00:00.000Z',
    }] })
    .mockResolvedValueOnce({ rows: [{
      id: 'entitlement-1',
      customer_id: '11111111-1111-4111-8111-111111111111',
      first_name: 'Alice',
      last_name: 'Customer',
      email: 'alice@example.com',
      agreement_id: 'agreement-1',
      partner_id: 41,
      restaurant_id: 9,
      restaurant_name: 'OxSteed Cafe',
      agreement_version: 1,
      agreement_status: 'active',
      settlement_currency_code: 'USD',
      status: 'active',
      starts_at: null,
      ends_at: null,
      max_transaction_cents: '2500',
      daily_limit_cents: '10000',
      reason: 'Customer benefit',
      metadata: {},
      created_by: null,
      created_at: '2026-09-12T12:00:00.000Z',
      updated_at: '2026-09-12T12:00:00.000Z',
    }] })
    .mockResolvedValueOnce({ rows: [{
      id: 'audit-1',
      action_type: 'credit.entitlement.upserted',
      actor_user_id: '22222222-2222-4222-8222-222222222222',
      customer_id: '11111111-1111-4111-8111-111111111111',
      partner_id: 41,
      resource_type: 'credit_entitlement',
      resource_id: 'entitlement-1',
      reason: 'Customer benefit',
      correlation_id: 'request-1',
      before_state: null,
      after_state: { status: 'active' },
      metadata: {},
      created_at: '2026-09-12T12:00:00.000Z',
    }] });

  const result = await getAdminCustomerCreditAccount({
    customerId: '11111111-1111-4111-8111-111111111111',
    currencyCode: 'USD',
  });

  expect(result.account).toMatchObject({ accountId: '7001', customerId: '11111111-1111-4111-8111-111111111111', availableBalanceCents: 10000 });
  expect(result.transactions[0]).toMatchObject({ restaurantName: 'OxSteed Cafe', direction: 'debit', status: 'posted', orderId: '123' });
  expect(result.holds[0]).toMatchObject({ restaurantName: 'OxSteed Bistro', status: 'active', amountCents: 1000 });
  expect(result.entitlements[0]).toMatchObject({ restaurantName: 'OxSteed Cafe', status: 'active' });
  expect(result.auditEvents[0]).toMatchObject({ actionType: 'credit.entitlement.upserted', customerId: '11111111-1111-4111-8111-111111111111' });
  expect(mockQuery.mock.calls[0][0]).toContain("u.role = 'customer'");
  expect(mockQuery.mock.calls[1][0]).toContain('t.debit_account_id = a.id OR t.credit_account_id = a.id');
  expect(mockQuery.mock.calls[2][0]).toContain('h.account_id = $1');
  expect(mockQuery.mock.calls[3][0]).toContain('e.customer_id = $1');
  expect(mockQuery.mock.calls[4][0]).toContain('customer_id = $1');
});

test('requires idempotency for agreement creation', async () => {
  await expect(createAgreement({
    partnerId: 41,
    startsAt: '2026-09-12T00:00:00.000Z',
  })).rejects.toMatchObject({ code: 'credit_idempotency_key_required', status: 400 });
  expect(mockQuery).not.toHaveBeenCalled();
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

  expect(result.run).toMatchObject({ status: 'balanced', scope: 'all_time_ledger' });
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
  expect(mockQuery.mock.calls[4][0]).toContain("t.currency_code = $5");
  expect(mockQuery.mock.calls[4][1]).toEqual([41, 'agreement-1', new Date('2026-09-01T00:00:00.000Z'), new Date('2026-09-02T00:00:00.000Z'), 'USD']);
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

test('replays an existing settlement after the partner is terminated', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{
      id: 'agreement-1',
      partner_id: 41,
      partner_status: 'terminated',
      restaurant_id: 9,
      restaurant_name: 'OxSteed Cafe',
      settlement_currency_code: 'USD',
    }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{
      id: 'settlement-existing',
      partner_id: 41,
      agreement_id: 'agreement-1',
      currency_code: 'USD',
      period_start: '2026-09-01T00:00:00.000Z',
      period_end: '2026-09-02T00:00:00.000Z',
      status: 'paid',
      gross_cents: '2500',
      refund_cents: '0',
      fee_cents: '0',
      net_cents: '2500',
      payment_reference: 'bank-1',
      metadata: {},
    }] });

  const result = await createSettlement({
    partnerId: 41,
    agreementId: 'agreement-1',
    periodStart: '2026-09-01T00:00:00.000Z',
    periodEnd: '2026-09-02T00:00:00.000Z',
    idempotencyKey: 'settlement-existing-key',
  });

  expect(result.replayed).toBe(true);
  expect(result.settlement.id).toBe('settlement-existing');
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

test('prevents two active agreements for one credit partner', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{
      id: 'agreement-2',
      partner_id: 41,
      partner_status: 'active',
      restaurant_id: 9,
      restaurant_name: 'OxSteed Cafe',
      status: 'pending_approval',
      starts_at: '2026-09-01T00:00:00.000Z',
      ends_at: null,
      settlement_currency_code: 'USD',
    }] })
    .mockResolvedValueOnce({ rows: [{ id: 'agreement-1' }] });

  await expect(transitionAgreement({
    agreementId: 'agreement-2',
    targetStatus: 'active',
    actorUserId: 'admin-1',
  })).rejects.toMatchObject({ code: 'credit_active_agreement_conflict', status: 409 });
  expect(mockQuery).toHaveBeenCalledTimes(2);
});
