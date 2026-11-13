'use strict';

// Domain 8 #7: food-wallet order-refund replay must compare the replayed
// amount/currency against the retry's request. Same idempotency key + a
// different amount used to be silently answered as a successful refund of
// the new amount, which was never written. Uses a fake client: the replay
// path returns before any ledger write, so no live database is needed.
const { refundWalletDebitForReference } = require('../services/foodWalletService');

const RESTAURANT_ID = 3;
const CUSTOMER_ID = '00000000-0000-4000-8000-000000000456';
const ORDER_REF = 'order-replay-1';

const ACCOUNT = {
  id: 55,
  restaurant_id: RESTAURANT_ID,
  customer_id: CUSTOMER_ID,
  currency_code: 'USD',
  balance_cents: 5000,
  reserved_cents: 0,
  status: 'active',
  ledger_version: 0,
  last_entry_hash: null,
};

const DEBIT_ENTRY = {
  id: 7,
  account_id: ACCOUNT.id,
  entry_type: 'debit',
  amount_cents: 5000,
  currency_code: 'USD',
  reference_type: 'food_order',
  reference_id: ORDER_REF,
};

function existingRefund(amountCents, currencyCode = 'USD') {
  return {
    id: 9,
    account_id: ACCOUNT.id,
    entry_type: 'refund',
    amount_cents: amountCents,
    currency_code: currencyCode,
    reference_type: 'food_order_refund',
    reference_id: `${ORDER_REF}:p1`,
  };
}

// Fake client answering only the reads refundWalletDebitForReference makes
// before the replay branch: account lookup, original-debit lookup, prior
// refund totals, and the replay lookup by idempotency key.
function fakeClient({ refundRow, priorRefundedCents = 2000, priorRefundCount = 1 }) {
  return {
    query: jest.fn(async (sql) => {
      if (/INSERT INTO food_customer_wallet_accounts/.test(sql)) return { rows: [] };
      if (/FROM food_customer_wallet_accounts a/.test(sql)) return { rows: [ACCOUNT] };
      if (/COALESCE\(SUM\(amount_cents\)/.test(sql)) {
        return { rows: [{ refunded_cents: priorRefundedCents, refund_count: priorRefundCount }] };
      }
      if (/entry_type = 'debit'/.test(sql)) return { rows: [DEBIT_ENTRY] };
      if (/idempotency_key/.test(sql)) return { rows: refundRow ? [refundRow] : [] };
      return { rows: [] };
    }),
  };
}

function refund(client, overrides = {}) {
  return refundWalletDebitForReference(client, {
    restaurantId: RESTAURANT_ID,
    customerId: CUSTOMER_ID,
    currencyCode: 'USD',
    orderReferenceId: ORDER_REF,
    correlationId: 'corr-replay-1',
    ...overrides,
  });
}

describe('food-wallet order-refund replay (Domain 8 #7)', () => {
  test('rejects a replay whose amount differs from the original refund', async () => {
    const client = fakeClient({ refundRow: existingRefund(2000) });
    await expect(refund(client, { amountCents: 3000 }))
      .rejects.toMatchObject({ code: 'wallet_ledger_idempotency_conflict', status: 409 });
    // The mismatched retry must not write a second ledger entry.
    expect(client.query.mock.calls.some(([sql]) => /INSERT INTO food_customer_wallet_ledger/.test(sql)))
      .toBe(false);
  });

  test('rejects a replay whose currency differs from the original refund', async () => {
    const client = fakeClient({ refundRow: existingRefund(2000, 'USD') });
    await expect(refund(client, { amountCents: 2000, currencyCode: 'EUR' }))
      .rejects.toMatchObject({ code: 'wallet_ledger_idempotency_conflict', status: 409 });
  });

  test('replays an exact-amount retry as success', async () => {
    const client = fakeClient({ refundRow: existingRefund(2000) });
    const result = await refund(client, { amountCents: 2000 });
    expect(result).toMatchObject({ refunded: true, replayed: true, amountCents: 2000 });
  });

  test('replays a full-refund retry (amount omitted) when the original was the full debit', async () => {
    const client = fakeClient({
      refundRow: existingRefund(5000),
      priorRefundedCents: 5000,
      priorRefundCount: 1,
    });
    const result = await refund(client);
    expect(result).toMatchObject({ refunded: true, replayed: true, amountCents: 5000 });
  });
});
