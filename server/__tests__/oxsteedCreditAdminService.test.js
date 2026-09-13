'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { createSettlement, reconcileCreditLedger, listReconciliationRuns, transitionSettlement, transitionAgreement, listAdminCustomerCreditAccounts, getAdminCustomerCreditAccount, listAdminCreditTransactions, listSettlements, getAdminCreditTransaction, listEntitlements, upsertEntitlement, expireCreditEntitlements, expireCreditAgreements, createAgreement, listPartners, listAgreements } = require('../services/oxsteedCreditAdminService');

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

test('lists a paginated partner directory with bounded database paging', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ total: 26 }] })
    .mockResolvedValueOnce({ rows: [{
      partner_id: 41,
      restaurant_id: 12,
      restaurant_name: 'OxSteed Cafe',
      status: 'active',
      settlement_currency_code: 'USD',
      agreement_count: 2,
      active_agreement_count: 1,
      updated_at: '2026-09-12T12:04:00.000Z',
    }] });

  const result = await listPartners({ search: 'cafe', status: 'active', limit: 10, offset: 20, includePagination: true });

  expect(result).toMatchObject({ pagination: { limit: 10, offset: 20, total: 26, hasMore: false, nextOffset: null } });
  expect(result.partners[0]).toMatchObject({ partnerId: '41', restaurantName: 'OxSteed Cafe', status: 'active' });
  expect(mockQuery.mock.calls[0][1]).toEqual(['%cafe%', 'active']);
  expect(mockQuery.mock.calls[1][0]).toContain('LIMIT $3 OFFSET $4');
  expect(mockQuery.mock.calls[1][1]).toEqual(['%cafe%', 'active', 11, 20]);
});

test('lists a paginated agreement directory with bounded database paging', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ total: 26 }] })
    .mockResolvedValueOnce({ rows: [{
      id: 'agreement-1',
      partner_id: 41,
      restaurant_id: 12,
      restaurant_name: 'OxSteed Cafe',
      settlement_currency_code: 'USD',
      version: 2,
      status: 'active',
      starts_at: '2026-09-01T00:00:00.000Z',
      ends_at: null,
      allowed_order_types: ['pickup'],
      allowed_categories: [],
      allowed_menu_item_ids: [],
      geography: {},
      customer_terms: 'Approved terms',
      max_transaction_cents: null,
      daily_customer_limit_cents: null,
      lifetime_customer_limit_cents: null,
      requires_customer_entitlement: false,
      metadata: {},
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-02T00:00:00.000Z',
    }] });

  const result = await listAgreements({ partnerId: 41, status: 'active', limit: 10, offset: 20, includePagination: true });

  expect(result).toMatchObject({ pagination: { limit: 10, offset: 20, total: 26, hasMore: false, nextOffset: null } });
  expect(result.agreements[0]).toMatchObject({ id: 'agreement-1', partnerId: '41', restaurantName: 'OxSteed Cafe', status: 'active' });
  expect(mockQuery.mock.calls[0][1]).toEqual([41, 'active']);
  expect(mockQuery.mock.calls[1][0]).toContain('LIMIT $3 OFFSET $4');
  expect(mockQuery.mock.calls[1][1]).toEqual([41, 'active', 11, 20]);
});

test('searches agreements by partner or restaurant identity', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ total: 1 }] })
    .mockResolvedValueOnce({ rows: [{
      id: 'agreement-search-1',
      partner_id: 41,
      restaurant_id: 12,
      restaurant_name: 'OxSteed Cafe',
      settlement_currency_code: 'USD',
      version: 1,
      status: 'active',
      allowed_order_types: ['pickup'],
      allowed_categories: [],
      allowed_menu_item_ids: [],
      geography: {},
      metadata: {},
    }] });

  const result = await listAgreements({ search: 'cafe', limit: 10, includePagination: true });

  expect(result).toMatchObject({ pagination: { total: 1, limit: 10, offset: 0, hasMore: false } });
  expect(result.agreements[0]).toMatchObject({ id: 'agreement-search-1', restaurantName: 'OxSteed Cafe' });
  expect(mockQuery.mock.calls[0][0]).toContain('fr.display_name ILIKE');
  expect(mockQuery.mock.calls[0][0]).toContain('CAST(a.partner_id AS TEXT) ILIKE');
  expect(mockQuery.mock.calls[0][1]).toEqual(['%cafe%']);
  expect(mockQuery.mock.calls[1][1]).toEqual(['%cafe%', 11, 0]);
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

test('records the prior entitlement state when access is updated', async () => {
  const customerId = '11111111-1111-4111-8111-111111111111';
  const agreementId = 'agreement-1';
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: agreementId, partner_id: 41 }] })
    .mockResolvedValueOnce({ rows: [{ id: customerId }] })
    .mockResolvedValueOnce({ rows: [{
      id: 'entitlement-1',
      customer_id: customerId,
      agreement_id: agreementId,
      status: 'active',
      starts_at: null,
      ends_at: '2026-09-30T00:00:00.000Z',
      max_transaction_cents: '2500',
      daily_limit_cents: '10000',
      metadata: { source: 'summer-program' },
      reason: 'Original partner access',
      created_by: '22222222-2222-4222-8222-222222222222',
    }] })
    .mockResolvedValueOnce({ rows: [{
      id: 'entitlement-1',
      customer_id: customerId,
      agreement_id: agreementId,
      status: 'suspended',
      starts_at: null,
      ends_at: '2026-10-31T00:00:00.000Z',
      max_transaction_cents: '5000',
      daily_limit_cents: '20000',
      metadata: { source: 'manual-review' },
      reason: 'Temporarily restricted pending review',
      created_by: '33333333-3333-4333-8333-333333333333',
    }] })
    .mockResolvedValueOnce({ rows: [] });

  const result = await upsertEntitlement({
    agreementId,
    customerId,
    status: 'suspended',
    endsAt: '2026-10-31T00:00:00.000Z',
    maxTransactionCents: 5000,
    dailyLimitCents: 20000,
    reason: 'Temporarily restricted pending review',
    metadata: { source: 'manual-review' },
    actorUserId: '33333333-3333-4333-8333-333333333333',
  });

  expect(result.entitlement).toMatchObject({ id: 'entitlement-1', status: 'suspended', maxTransactionCents: 5000 });
  expect(mockQuery.mock.calls[2][0]).toContain('FOR UPDATE');
  expect(mockQuery.mock.calls[3][0]).toContain('UPDATE oxsteed_credit_customer_entitlements');
  expect(mockQuery.mock.calls[4][1]).toEqual([
    'credit.entitlement.upserted',
    '33333333-3333-4333-8333-333333333333',
    customerId,
    41,
    'credit_entitlement',
    'entitlement-1',
    'Temporarily restricted pending review',
    JSON.stringify({
      status: 'active',
      startsAt: null,
      endsAt: '2026-09-30T00:00:00.000Z',
      maxTransactionCents: 2500,
      dailyLimitCents: 10000,
      metadata: { source: 'summer-program' },
      reason: 'Original partner access',
      createdBy: '22222222-2222-4222-8222-222222222222',
    }),
    JSON.stringify({
      status: 'suspended',
      startsAt: null,
      endsAt: '2026-10-31T00:00:00.000Z',
      maxTransactionCents: 5000,
      dailyLimitCents: 20000,
      metadata: { source: 'manual-review' },
      reason: 'Temporarily restricted pending review',
      createdBy: '33333333-3333-4333-8333-333333333333',
    }),
    JSON.stringify({}),
  ]);
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

test('lists platform Credit transactions with safe filters and pagination', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'transaction-1',
    transaction_type: 'purchase',
    status: 'posted',
    amount_cents: '2500',
    currency_code: 'USD',
    partner_id: 41,
    agreement_id: 'agreement-1',
    reference_type: 'food_order',
    reference_id: '9001',
    description: 'Restaurant order',
    actor_type: 'customer',
    actor_user_id: '11111111-1111-4111-8111-111111111111',
    metadata: {},
    posted_at: '2026-09-12T12:00:00.000Z',
    created_at: '2026-09-12T12:00:00.000Z',
    debit_customer_id: '11111111-1111-4111-8111-111111111111',
    credit_customer_id: null,
    restaurant_name: 'OxSteed Cafe',
  }, {
    id: 'transaction-older',
    transaction_type: 'purchase',
    status: 'posted',
    amount_cents: '1000',
    currency_code: 'USD',
    partner_id: 41,
    agreement_id: 'agreement-1',
    reference_type: 'food_order',
    reference_id: '8999',
    posted_at: '2026-09-11T12:00:00.000Z',
    created_at: '2026-09-11T12:00:00.000Z',
  }] });

  const result = await listAdminCreditTransactions({ partnerId: 41, transactionType: 'purchase', status: 'posted', currencyCode: 'USD', limit: 1, offset: 2, includePagination: true });

  expect(result).toMatchObject({ pagination: { limit: 1, offset: 2, hasMore: true, nextOffset: 3 } });
  expect(result.transactions[0]).toMatchObject({ id: 'transaction-1', orderId: '9001', restaurantName: 'OxSteed Cafe' });
  expect(mockQuery.mock.calls[0][0]).toContain('t.partner_id = $1');
  expect(mockQuery.mock.calls[0][0]).toContain('t.transaction_type = $2');
  expect(mockQuery.mock.calls[0][0]).toContain('t.status = $3');
  expect(mockQuery.mock.calls[0][0]).toContain('t.currency_code = $4');
  expect(mockQuery.mock.calls[0][1]).toEqual([41, 'purchase', 'posted', 'USD', 2, 2]);
});

test('lists settlements with partner, status, and currency filters', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'settlement-1',
    partner_id: 41,
    agreement_id: 'agreement-1',
    restaurant_id: 9,
    restaurant_name: 'OxSteed Cafe',
    currency_code: 'EUR',
    period_start: '2026-09-01T00:00:00.000Z',
    period_end: '2026-09-08T00:00:00.000Z',
    gross_cents: '5000',
    refund_cents: '500',
    fee_cents: '100',
    net_cents: '4400',
    status: 'paid',
    payment_reference: 'bank-1',
    created_by: 'admin-creator',
    approved_by: 'admin-1',
    paid_at: '2026-09-09T00:00:00.000Z',
    metadata: {},
    created_at: '2026-09-08T00:00:00.000Z',
    updated_at: '2026-09-09T00:00:00.000Z',
  }] });

  const result = await listSettlements({ partnerId: 41, status: 'paid', currencyCode: 'EUR', limit: 10, offset: 20, includePagination: true });

  expect(result).toMatchObject({ pagination: { limit: 10, offset: 20, hasMore: false, nextOffset: null } });
  expect(result.settlements[0]).toMatchObject({ partnerId: '41', restaurantName: 'OxSteed Cafe', currencyCode: 'EUR', netCents: 4400, createdBy: 'admin-creator', approvedBy: 'admin-1' });
  expect(mockQuery.mock.calls[0][0]).toContain('s.partner_id = $1');
  expect(mockQuery.mock.calls[0][0]).toContain('s.status = $2');
  expect(mockQuery.mock.calls[0][0]).toContain('s.currency_code = $3');
  expect(mockQuery.mock.calls[0][1]).toEqual([41, 'paid', 'EUR', 11, 20]);
});

test('loads a complete admin Credit transaction with journal and audit context', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{
      id: 'transaction-1',
      transaction_type: 'purchase',
      status: 'posted',
      amount_cents: '2500',
      currency_code: 'USD',
      partner_id: 41,
      agreement_id: 'agreement-1',
      reference_type: 'food_order',
      reference_id: '9001',
      idempotency_key: 'purchase-9001',
      correlation_id: 'request-1',
      description: 'Restaurant order',
      actor_type: 'customer',
      actor_user_id: '11111111-1111-4111-8111-111111111111',
      metadata: { source: 'checkout' },
      posted_at: '2026-09-12T12:00:00.000Z',
      reversed_at: null,
      created_at: '2026-09-12T12:00:00.000Z',
      updated_at: '2026-09-12T12:00:00.000Z',
      debit_account_id: 7001,
      debit_account_type: 'customer_wallet',
      debit_customer_id: '11111111-1111-4111-8111-111111111111',
      debit_partner_id: null,
      debit_customer_email: 'alice@example.com',
      credit_account_id: 8001,
      credit_account_type: 'partner_payable',
      credit_customer_id: null,
      credit_partner_id: 41,
      credit_customer_email: null,
      restaurant_name: 'OxSteed Cafe',
    }] })
    .mockResolvedValueOnce({ rows: [{
      id: 91,
      account_id: 7001,
      entry_side: 'debit',
      amount_cents: '2500',
      balance_after_cents: '10000',
      sequence: '8',
      previous_entry_hash: 'hash-7',
      entry_hash: 'hash-8',
      metadata: {},
      created_at: '2026-09-12T12:00:00.000Z',
      account_type: 'customer_wallet',
      customer_id: '11111111-1111-4111-8111-111111111111',
      partner_id: null,
    }, {
      id: 92,
      account_id: 8001,
      entry_side: 'credit',
      amount_cents: '2500',
      balance_after_cents: '2500',
      sequence: '3',
      previous_entry_hash: null,
      entry_hash: 'hash-9',
      metadata: {},
      created_at: '2026-09-12T12:00:00.000Z',
      account_type: 'partner_payable',
      customer_id: null,
      partner_id: 41,
    }] })
    .mockResolvedValueOnce({ rows: [{
      id: 300,
      action_type: 'credit.purchase.posted',
      actor_user_id: null,
      customer_id: '11111111-1111-4111-8111-111111111111',
      partner_id: 41,
      resource_type: 'credit_transaction',
      resource_id: 'transaction-1',
      reason: 'Food order captured',
      correlation_id: 'request-1',
      before_state: null,
      after_state: { status: 'posted' },
      metadata: {},
      created_at: '2026-09-12T12:00:01.000Z',
    }] });

  const result = await getAdminCreditTransaction('transaction-1');

  expect(result.transaction).toMatchObject({
    id: 'transaction-1',
    orderId: '9001',
    restaurantName: 'OxSteed Cafe',
    idempotencyKey: 'purchase-9001',
    debitAccount: { accountId: '7001', accountType: 'customer_wallet', customerEmail: 'alice@example.com' },
    creditAccount: { accountId: '8001', accountType: 'partner_payable', partnerId: '41' },
  });
  expect(result.transaction.entries).toHaveLength(2);
  expect(result.transaction.auditEvents[0]).toMatchObject({ actionType: 'credit.purchase.posted', resourceId: 'transaction-1' });
  expect(mockQuery.mock.calls[1][1]).toEqual(['transaction-1']);
  expect(mockQuery.mock.calls[2][1]).toEqual(['credit_transaction', 'transaction-1', 100, 0]);
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
    }] })
    .mockResolvedValueOnce({ rows: [{
      id: 'dispute-1',
      transaction_id: 'transaction-1',
      customer_id: '11111111-1111-4111-8111-111111111111',
      partner_id: 41,
      restaurant_name: 'OxSteed Cafe',
      status: 'in_review',
      reason_code: 'incorrect_amount',
      description: 'The posted amount does not match the order.',
      resolution: null,
      opened_by: '11111111-1111-4111-8111-111111111111',
      resolved_by: null,
      opened_at: '2026-09-12T12:30:00.000Z',
      resolved_at: null,
      updated_at: '2026-09-12T12:30:00.000Z',
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
  expect(result.disputes[0]).toMatchObject({ id: 'dispute-1', status: 'in_review', reasonCode: 'incorrect_amount', restaurantName: 'OxSteed Cafe' });
  expect(mockQuery.mock.calls[0][0]).toContain("u.role = 'customer'");
  expect(mockQuery.mock.calls[1][0]).toContain('t.debit_account_id = a.id OR t.credit_account_id = a.id');
  expect(mockQuery.mock.calls[2][0]).toContain('h.account_id = $1');
  expect(mockQuery.mock.calls[3][0]).toContain('e.customer_id = $1');
  expect(mockQuery.mock.calls[4][0]).toContain('customer_id = $1');
  expect(mockQuery.mock.calls[5][0]).toContain('d.customer_id = $1');
});

test('requires idempotency for agreement creation', async () => {
  await expect(createAgreement({
    partnerId: 41,
    startsAt: '2026-09-12T00:00:00.000Z',
  })).rejects.toMatchObject({ code: 'credit_idempotency_key_required', status: 400 });
  expect(mockQuery).not.toHaveBeenCalled();
});

test('does not create new agreements for terminated partners', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 41, status: 'terminated' }] });

  await expect(createAgreement({
    partnerId: 41,
    startsAt: '2026-09-12T00:00:00.000Z',
    reason: 'Attempted reactivation review',
    idempotencyKey: 'credit-agreement-terminated-1',
  })).rejects.toMatchObject({ code: 'credit_partner_terminated', status: 409 });

  expect(mockQuery).toHaveBeenCalledTimes(2);
});

test('marks ended customer entitlements expired and records the transition', async () => {
  const customerId = '11111111-1111-4111-8111-111111111111';
  const endedAt = new Date('2026-09-12T00:00:00.000Z');
  mockQuery
    .mockResolvedValueOnce({ rows: [{
      id: 'entitlement-1',
      customer_id: customerId,
      partner_id: 41,
      agreement_id: 'agreement-1',
      status: 'active',
      starts_at: null,
      ends_at: endedAt,
      max_transaction_cents: null,
      daily_limit_cents: null,
      metadata: {},
      reason: 'Summer program',
      created_by: null,
      created_at: endedAt,
      updated_at: endedAt,
    }] })
    .mockResolvedValueOnce({ rows: [{
      id: 'entitlement-1',
      customer_id: customerId,
      partner_id: 41,
      agreement_id: 'agreement-1',
      status: 'expired',
      starts_at: null,
      ends_at: endedAt,
      max_transaction_cents: null,
      daily_limit_cents: null,
      metadata: {},
      reason: 'Summer program',
      created_by: null,
      created_at: endedAt,
      updated_at: new Date('2026-09-13T00:00:00.000Z'),
    }] })
    .mockResolvedValueOnce({ rows: [] });

  const result = await expireCreditEntitlements({ now: new Date('2026-09-13T00:00:00.000Z'), limit: 10 });

  expect(result).toMatchObject({ count: 1, expired: [{ id: 'entitlement-1', status: 'expired', customerId }] });
  expect(mockQuery.mock.calls[0][0]).toContain("e.status IN ('active', 'suspended')");
  expect(mockQuery.mock.calls[0][0]).toContain('FOR UPDATE SKIP LOCKED');
  expect(mockQuery.mock.calls[1][0]).toContain("SET status = 'expired'");
  expect(mockQuery.mock.calls[2][1]).toEqual([
    'credit.entitlement.expired',
    null,
    customerId,
    41,
    'credit_entitlement',
    'entitlement-1',
    'Entitlement validity window ended',
    JSON.stringify({ status: 'active', endsAt: endedAt }),
    JSON.stringify({ status: 'expired', endsAt: endedAt }),
    JSON.stringify({}),
  ]);
});

test('marks ended agreements expired and records the transition', async () => {
  const endedAt = new Date('2026-09-12T00:00:00.000Z');
  mockQuery
    .mockResolvedValueOnce({ rows: [{
      id: 'agreement-1',
      partner_id: 41,
      restaurant_id: 9,
      restaurant_name: 'OxSteed Cafe',
      settlement_currency_code: 'USD',
      version: 2,
      status: 'active',
      starts_at: new Date('2026-09-01T00:00:00.000Z'),
      ends_at: endedAt,
      allowed_order_types: ['pickup'],
      allowed_categories: [],
      allowed_menu_item_ids: [],
      geography: {},
      customer_terms: 'Summer program',
      max_transaction_cents: null,
      daily_customer_limit_cents: null,
      lifetime_customer_limit_cents: null,
      metadata: {},
      created_by: null,
      approved_by: null,
      created_at: new Date('2026-09-01T00:00:00.000Z'),
      updated_at: endedAt,
    }] })
    .mockResolvedValueOnce({ rows: [{
      id: 'agreement-1',
      partner_id: 41,
      version: 2,
      status: 'expired',
      starts_at: new Date('2026-09-01T00:00:00.000Z'),
      ends_at: endedAt,
      allowed_order_types: ['pickup'],
      allowed_categories: [],
      allowed_menu_item_ids: [],
      geography: {},
      customer_terms: 'Summer program',
      max_transaction_cents: null,
      daily_customer_limit_cents: null,
      lifetime_customer_limit_cents: null,
      metadata: {},
      created_by: null,
      approved_by: null,
      created_at: new Date('2026-09-01T00:00:00.000Z'),
      updated_at: new Date('2026-09-13T00:00:00.000Z'),
    }] })
    .mockResolvedValueOnce({ rows: [] });

  const result = await expireCreditAgreements({ now: new Date('2026-09-13T00:00:00.000Z'), limit: 10 });

  expect(result).toMatchObject({ count: 1, expired: [{ id: 'agreement-1', status: 'expired', restaurantName: 'OxSteed Cafe' }] });
  expect(mockQuery.mock.calls[0][0]).toContain("a.status NOT IN ('expired', 'terminated')");
  expect(mockQuery.mock.calls[0][0]).toContain('FOR UPDATE SKIP LOCKED');
  expect(mockQuery.mock.calls[1][0]).toContain("SET status = 'expired'");
  expect(mockQuery.mock.calls[2][1]).toEqual([
    'credit.agreement.expired',
    null,
    null,
    41,
    'credit_agreement',
    'agreement-1',
    'Agreement validity window ended',
    JSON.stringify({ status: 'active', endsAt: endedAt }),
    JSON.stringify({ status: 'expired', endsAt: endedAt }),
    JSON.stringify({}),
  ]);
});

test('requires a reason for manual Credit reconciliation', async () => {
  await expect(reconcileCreditLedger({
    currencyCode: 'USD',
    periodStart: '2026-09-11T00:00:00.000Z',
    periodEnd: '2026-09-12T00:00:00.000Z',
    actorUserId: '22222222-2222-4222-8222-222222222222',
  })).rejects.toMatchObject({ code: 'credit_audit_reason_required', status: 400 });

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

test('lists bounded reconciliation history with currency and status filters', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'run-2',
    currency_code: 'USD',
    period_start: '2026-09-12T00:00:00.000Z',
    period_end: '2026-09-13T00:00:00.000Z',
    status: 'difference',
    account_balance_cents: '1000',
    journal_balance_cents: '900',
    difference_cents: '100',
    account_count: 2,
    entry_count: 4,
    completed_by: '22222222-2222-4222-8222-222222222222',
    started_at: '2026-09-13T01:00:00.000Z',
    completed_at: '2026-09-13T01:00:02.000Z',
    metadata: { scope: 'all_time_ledger' },
  }, {
    id: 'run-older',
    currency_code: 'USD',
    period_start: '2026-09-11T00:00:00.000Z',
    period_end: '2026-09-12T00:00:00.000Z',
    status: 'difference',
    account_balance_cents: '900',
    journal_balance_cents: '800',
    difference_cents: '100',
    account_count: 2,
    entry_count: 3,
    started_at: '2026-09-12T01:00:00.000Z',
  }] });

  const result = await listReconciliationRuns({ currencyCode: 'USD', status: 'difference', limit: 1, offset: 2 });

  expect(result.runs).toEqual([expect.objectContaining({ id: 'run-2', currencyCode: 'USD', status: 'difference', differenceCents: 100 })]);
  expect(result.pagination).toEqual({ limit: 1, offset: 2, hasMore: true, nextOffset: 3 });
  expect(mockQuery.mock.calls[0][0]).toContain('currency_code = $1');
  expect(mockQuery.mock.calls[0][0]).toContain('status = $2');
  expect(mockQuery.mock.calls[0][1]).toEqual(['USD', 'difference', 2, 2]);
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
    reason: 'Month-end partner settlement review',
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
    reason: 'Payment review completed',
  })).rejects.toMatchObject({ code: 'credit_settlement_payment_reference_required' });
  expect(mockQuery).toHaveBeenCalledTimes(1);
});

test('requires approval evidence before paying a settlement', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'settlement-without-approval',
    partner_id: 41,
    partner_status: 'active',
    restaurant_id: 9,
    restaurant_name: 'OxSteed Cafe',
    currency_code: 'USD',
    net_cents: '2500',
    status: 'approved',
    approved_by: null,
    payment_reference: 'bank-1',
  }] });

  await expect(transitionSettlement({
    settlementId: 'settlement-without-approval',
    targetStatus: 'paid',
    actorUserId: 'admin-1',
    reason: 'Payment review completed',
  })).rejects.toMatchObject({ code: 'credit_settlement_approval_required', status: 409 });
  expect(mockQuery).toHaveBeenCalledTimes(1);
});

test('requires an audit reason for a real settlement transition', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'settlement-pending',
    partner_id: 41,
    partner_status: 'active',
    restaurant_id: 9,
    restaurant_name: 'OxSteed Cafe',
    currency_code: 'USD',
    net_cents: '0',
    status: 'pending',
    payment_reference: null,
  }] });

  await expect(transitionSettlement({
    settlementId: 'settlement-pending',
    targetStatus: 'approved',
    actorUserId: 'admin-1',
  })).rejects.toMatchObject({ code: 'credit_audit_reason_required', status: 400 });
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
