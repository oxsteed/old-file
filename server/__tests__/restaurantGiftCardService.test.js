'use strict';

const service = require('../services/restaurantGiftCardService');

describe('restaurant gift-card value service', () => {
  test('rejects malformed codes, missing identities and invalid expiry dates', async () => {
    expect(() => service.normalizeCode('short')).toThrow(/invalid/i);
    expect(() => service.normalizeIdempotencyKey('')).toThrow(/Idempotency/);
    const client={query:jest.fn(async sql=>({rows:sql.includes('FROM restaurant_gift_card_products')?[{id:1,restaurant_id:2,amount_cents:2500,currency_code:'USD',delivery_type:'physical',is_active:true}]:[]}))};
    for (const expiresAt of ['2030-02-30T00:00:00.000Z','2020-01-01T00:00:00.000Z']) {
      await expect(service.issueGiftCard(client,{restaurantId:2,productId:1,actorUserId:'fixture',idempotencyKey:'expiry',expiresAt})).rejects.toMatchObject({code:'gift_card_expiry_invalid'});
    }
  });

  test('redeem uses a transaction-safe row lock and append-only ledger contract', async () => {
    const calls = [];
    const client = {
      query: jest.fn(async (sql, params) => {
        calls.push({ sql, params });
        if (/SELECT l\.\*, c\.\*/.test(sql)) return { rows: [] };
        if (/SELECT \* FROM restaurant_gift_cards/.test(sql)) return { rows: [{
          id: 5, restaurant_id: 2, code_last4: '6789', delivery_type: 'e_gift',
          currency_code: 'USD', balance_cents: 2500, initial_balance_cents: 2500,
          status: 'active', expires_at: null,
        }] };
        if (/UPDATE restaurant_gift_cards/.test(sql)) return { rows: [{
          id: 5, restaurant_id: 2, product_id: 9, code_last4: '6789', delivery_type: 'e_gift',
          currency_code: 'USD', balance_cents: 1500, initial_balance_cents: 2500,
          status: 'active', expires_at: null,
        }] };
        if (/INSERT INTO restaurant_gift_card_ledger/.test(sql)) return { rows: [{ id: 44, event_type: 'redeem', delta_cents: -1000 }] };
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const result = await service.redeemGiftCard(client, {
      restaurantId: 2, code: 'ABCD2345EFGH6789', amountCents: 1000,
      currencyCode: 'USD', actorUserId: 'user-1', idempotencyKey: 'pos-1', foodOrderId: 88,
    });
    expect(result.card.balanceCents).toBe(1500);
    expect(result.ledger.event_type).toBe('redeem');
    expect(calls.some(({ sql }) => /FOR UPDATE/.test(sql))).toBe(true);
    expect(calls.some(({ sql }) => /INSERT INTO restaurant_gift_card_ledger/.test(sql))).toBe(true);
  });

  test('refund requires and caps against the original redemption', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        if (/SELECT l\.\*, c\.\*/.test(sql)) return { rows: [] };
        if (/SELECT \* FROM restaurant_gift_cards/.test(sql)) return { rows: [{
          id: 5, restaurant_id: 2, product_id: 9, code_last4: '6789', delivery_type: 'e_gift',
          currency_code: 'USD', balance_cents: 0, initial_balance_cents: 2500,
          status: 'depleted', expires_at: null,
        }] };
        if (/SELECT id, delta_cents/.test(sql)) return { rows: [{ id: 44, delta_cents: -1000 }] };
        if (/SELECT COALESCE/.test(sql)) return { rows: [{ refunded_cents: '0' }] };
        if (/UPDATE restaurant_gift_cards/.test(sql)) return { rows: [{
          id: 5, restaurant_id: 2, product_id: 9, code_last4: '6789', delivery_type: 'e_gift',
          currency_code: 'USD', balance_cents: 1000, initial_balance_cents: 2500,
          status: 'active', expires_at: null,
        }] };
        if (/INSERT INTO restaurant_gift_card_ledger/.test(sql)) return { rows: [{ id: 45, event_type: 'refund', delta_cents: 1000 }] };
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const result = await service.redeemGiftCard(client, {
      restaurantId: 2, code: 'ABCD2345EFGH6789', amountCents: 1000,
      currencyCode: 'USD', actorUserId: 'user-1', idempotencyKey: 'refund-1',
      eventType: 'refund', originalLedgerId: 44,
    });
    expect(result.card.balanceCents).toBe(1000);
    expect(result.ledger.event_type).toBe('refund');
  });

  test('refund rejects an amount above the remaining original redemption', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        if (/SELECT l\.\*, c\.\*/.test(sql)) return { rows: [] };
        if (/SELECT \* FROM restaurant_gift_cards/.test(sql)) return { rows: [{
          id: 5, restaurant_id: 2, code_last4: '6789', currency_code: 'USD',
          balance_cents: 0, initial_balance_cents: 2500, status: 'depleted', expires_at: null,
        }] };
        if (/SELECT id, delta_cents/.test(sql)) return { rows: [{ id: 44, delta_cents: -1000 }] };
        if (/SELECT COALESCE/.test(sql)) return { rows: [{ refunded_cents: '500' }] };
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    await expect(service.redeemGiftCard(client, {
      restaurantId: 2, code: 'ABCD2345EFGH6789', amountCents: 501,
      currencyCode: 'USD', actorUserId: 'user-1', idempotencyKey: 'refund-2',
      eventType: 'refund', originalLedgerId: 44,
    })).rejects.toMatchObject({ code: 'gift_card_refund_exceeds_redemption' });
  });
});
