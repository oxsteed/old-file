'use strict';

const {
  recordWalletCreditPaymentForOrder,
  recordWalletCreditRefundForOrder,
  applyStripePaymentIntent,
  applyStripeRefund,
  applyStripeChargeRefund,
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
        .mockResolvedValueOnce({ rows: [{ location_id: 21 }] }) // F-02: order store lookup
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

    expect(client.query).toHaveBeenCalledTimes(3);
    // The insert attempt carried the order's store as its last parameter.
    expect(client.query.mock.calls[1][1][11]).toBe(21);
  });

  test('rejects a refund retry that changes the original payment identity', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ location_id: 21 }] }) // F-02: order store lookup
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

    expect(client.query).toHaveBeenCalledTimes(3);
  });
});

describe('restaurant POS Stripe payment verification', () => {
  function paymentRow(overrides = {}) {
    return {
      id: 901,
      food_order_id: 44,
      amount_cents: 1200,
      payment_type: 'card',
      provider: 'stripe_terminal',
      provider_payment_intent_id: 'pi_pos_1',
      provider_account_id: null,
      order_currency: 'USD',
      ...overrides,
    };
  }

  test('rejects a succeeded intent with a mismatched amount or currency', async () => {
    const client = {
      query: jest.fn().mockImplementation(async (sql) => {
        if (/SELECT p\.\*, fo\.currency_code/.test(sql)) return { rows: [paymentRow()] };
        return { rows: [] };
      }),
    };

    await expect(applyStripePaymentIntent(client, {
      id: 'pi_pos_1', status: 'succeeded', amount_received: 1100, currency: 'eur',
    })).rejects.toMatchObject({ code: 'pos_payment_verification_failed' });
    expect(client.query.mock.calls.some(([sql]) => /SET status =/.test(sql))).toBe(false);
  });

  test('requires a connected account when the POS row records one', async () => {
    const client = {
      query: jest.fn().mockImplementation(async (sql) => {
        if (/SELECT p\.\*, fo\.currency_code/.test(sql)) return { rows: [paymentRow({ provider_account_id: 'acct_expected' })] };
        return { rows: [] };
      }),
    };

    await expect(applyStripePaymentIntent(client, {
      id: 'pi_pos_1', status: 'succeeded', amount_received: 1200, currency: 'usd',
    }, 'acct_other')).rejects.toMatchObject({ code: 'pos_payment_verification_failed' });
  });
});

describe('restaurant POS Stripe refund verification', () => {
  test('rejects a refund whose amount or payment intent does not match', async () => {
    const client = {
      query: jest.fn().mockImplementation(async (sql) => {
        if (/SELECT p\.\*, fo\.currency_code/.test(sql)) {
          return { rows: [{
            id: 902,
            food_order_id: 44,
            amount_cents: 300,
            order_currency: 'USD',
            metadata: { originalPaymentId: 901 },
          }] };
        }
        if (/SELECT id, provider_payment_intent_id/.test(sql)) {
          return { rows: [{ id: 901, provider_payment_intent_id: 'pi_expected', provider_account_id: null }] };
        }
        return { rows: [] };
      }),
    };

    await expect(applyStripeRefund(client, {
      id: 're_pos_1',
      amount: 250,
      currency: 'eur',
      payment_intent: 'pi_other',
      status: 'succeeded',
      metadata: { pos_refund_payment_id: '902' },
    })).rejects.toMatchObject({ code: 'pos_refund_verification_failed' });
    expect(client.query.mock.calls.some(([sql]) => /SET status =/.test(sql))).toBe(false);
  });

  test('rejects a charge refund whose amount, currency, or connected account does not match', async () => {
    const client = {
      query: jest.fn().mockImplementation(async (sql) => {
        if (/SELECT p\.\*, fo\.currency_code/.test(sql)) {
          return { rows: [{
            id: 901,
            food_order_id: 44,
            amount_cents: 1000,
            provider_account_id: 'acct_expected',
            order_currency: 'USD',
          }] };
        }
        return { rows: [] };
      }),
    };

    await expect(applyStripeChargeRefund(client, {
      id: 'ch_pos_1',
      payment_intent: 'pi_pos_1',
      amount_refunded: 1100,
      currency: 'eur',
    }, 'acct_other')).rejects.toMatchObject({ code: 'pos_refund_verification_failed' });
    expect(client.query.mock.calls.some(([sql]) => /INSERT INTO restaurant_pos_payments/.test(sql))).toBe(false);
  });
});
