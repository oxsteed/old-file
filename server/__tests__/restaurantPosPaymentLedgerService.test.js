'use strict';

const {
  recordWalletCreditPaymentForOrder,
  recordWalletCreditRefundForOrder,
} = require('../services/restaurantPosPaymentLedgerService');

function existingPayment(overrides = {}) {
  return {
    id: 901,
    food_order_id: 44,
    shift_id: 7,
    payment_type: 'wallet_credit',
    amount_cents: 1200,
    provider: 'food_wallet',
    metadata: {
      source: 'food_wallet',
      currencyCode: 'USD',
      walletAccountId: '55',
      walletLedgerEntryId: '700',
      customerId: 'customer-1',
    },
    ...overrides,
  };
}

describe('restaurant POS wallet payment idempotency', () => {
  test('rejects a payment retry that changes the order or amount', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [existingPayment()] }),
    };

    await expect(recordWalletCreditPaymentForOrder(client, {
      restaurantId: 3,
      orderId: 45,
      amountCents: 1300,
      currencyCode: 'USD',
      walletAccountId: '55',
      walletLedgerEntryId: '700',
      idempotencyKey: 'wallet-payment-retry',
      shiftId: 7,
      metadata: { customerId: 'customer-1' },
    })).rejects.toMatchObject({ code: 'pos_payment_idempotency_conflict', status: 409 });

    expect(client.query).toHaveBeenCalledTimes(2);
  });

  test('rejects a refund retry that changes the original payment identity', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [existingPayment({
            payment_type: 'refund',
            amount_cents: 300,
            metadata: {
              source: 'food_wallet',
              currencyCode: 'USD',
              walletAccountId: '55',
              walletRefundLedgerEntryId: '701',
              walletOriginalLedgerEntryId: '700',
              originalPaymentId: '900',
            },
          })],
        }),
    };

    await expect(recordWalletCreditRefundForOrder(client, {
      restaurantId: 3,
      orderId: 44,
      amountCents: 300,
      currencyCode: 'USD',
      walletAccountId: '55',
      walletRefundLedgerEntryId: '702',
      walletOriginalLedgerEntryId: '700',
      idempotencyKey: 'wallet-refund-retry',
      metadata: { originalPaymentId: '900' },
    })).rejects.toMatchObject({ code: 'pos_payment_idempotency_conflict', status: 409 });

    expect(client.query).toHaveBeenCalledTimes(2);
  });
});
