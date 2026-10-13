'use strict';

// Bundle D (loyalty/invoices) regression tests for the broken-findings fixes.
// P3-9-F02, F03, F06, F13, F15.

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const {
  validateLineItems,
  computeInvoiceTotals,
} = require('../utils/businessInvoiceHelpers');
const foodCtrl = require('../controllers/foodController');

jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'admin-1', role: 'super_admin', email: 'admin@example.com' };
    next();
  },
  optionalAuth: (_req, _res, next) => next(),
}));
jest.mock('../middleware/adminAuth', () => ({
  requireSuperAdmin: (_req, _res, next) => next(),
  requireAdmin: (_req, _res, next) => next(),
}));
jest.mock('../services/socketService', () => ({
  broadcastToBusinessInbox: jest.fn(),
  broadcastToRestaurantDisplay: jest.fn(),
}));

function buildInvoicesApp() {
  const app = express();
  app.use(express.json());
  // eslint-disable-next-line global-require
  app.use('/api/invoices', require('../routes/invoices'));
  app.use(errorHandler);
  return app;
}

function buildQuoteApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: '00000000-0000-4000-8000-000000000456', email: 'guest@example.com' };
    next();
  });
  app.post('/api/food/restaurants/:restaurantId/orders/quote', foodCtrl.quoteOrder);
  app.use(errorHandler);
  return app;
}

function fakeClient(responses) {
  const queue = [...responses];
  const calls = [];
  return {
    calls,
    query: jest.fn(async (text, values) => {
      calls.push({ text, values });
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next || { rows: [] };
    }),
  };
}

beforeEach(() => resetMocks());

describe('P3-9-F13 invoice line-item types', () => {
  test('legacy item-only invoices compute exactly as before', () => {
    expect(validateLineItems([
      { description: 'Work', quantity: 2, unit_price: 50 },
      { description: 'Parts', quantity: 1, unit_price: 25.5 },
    ])).toBeNull();
    expect(computeInvoiceTotals([
      { description: 'Work', quantity: 2, unit_price: 50 },
      { description: 'Parts', quantity: 1, unit_price: 25.5 },
    ], 10)).toEqual({
      subtotal: 125.5, tax_amount: 12.55, total: 138.05,
      discount_total: 0, fee_total: 0,
    });
  });

  test('discount lines reduce the taxable subtotal; fee lines add after tax', () => {
    const totals = computeInvoiceTotals([
      { description: 'Work', quantity: 1, unit_price: 100, type: 'item' },
      { description: 'Loyalty discount', quantity: 1, unit_price: 10, type: 'discount' },
      { description: 'Rush fee', quantity: 1, unit_price: 5, type: 'fee' },
    ], 10);
    // subtotal 90, tax 9, fees 5 -> total 104
    expect(totals).toEqual({
      subtotal: 90, tax_amount: 9, total: 104,
      discount_total: 10, fee_total: 5,
    });
  });

  test('unknown types, negative amounts, and oversized discounts are rejected', () => {
    expect(validateLineItems([{ description: 'x', quantity: 1, unit_price: 1, type: 'bogus' }]))
      .toMatch(/unknown type/);
    expect(validateLineItems([{ description: 'x', quantity: -1, unit_price: 1 }]))
      .toMatch(/quantity/);
    expect(validateLineItems([{ description: 'x', quantity: 1, unit_price: -5 }]))
      .toMatch(/unit price/);
    expect(validateLineItems([
      { description: 'Work', quantity: 1, unit_price: 100, type: 'item' },
      { description: 'Too big', quantity: 1, unit_price: 101, type: 'discount' },
    ])).toMatch(/cannot exceed/);
    expect(validateLineItems([])).toMatch(/At least one/);
  });
});

describe('P3-9-F03 super-admin invoice guards', () => {
  test('mark-paid on an already-paid invoice is rejected (409)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 7, status: 'paid', total: '100.00', amount_paid: '100.00', invoice_number: 'INV-1' }],
    });
    const res = await request(buildInvoicesApp()).patch('/api/invoices/7/mark-paid');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/fully paid/);
    // No UPDATE should have run.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('mark-paid on a cancelled invoice is rejected (400)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 8, status: 'cancelled', total: '100.00', amount_paid: '0.00', invoice_number: 'INV-2' }],
    });
    const res = await request(buildInvoicesApp()).patch('/api/invoices/8/mark-paid');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cancelled/);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('mark-paid on a sent unpaid invoice succeeds and stamps paid_at', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 9, status: 'sent', total: '100.00', amount_paid: '0.00', invoice_number: 'INV-3' }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 9, status: 'paid', total: '100.00', amount_paid: '100.00', invoice_number: 'INV-3' }],
      })
      .mockResolvedValueOnce({ rows: [] }); // audit log insert (swallowed on failure anyway)
    const res = await request(buildInvoicesApp()).patch('/api/invoices/9/mark-paid');
    expect(res.status).toBe(200);
    expect(res.body.invoice.status).toBe('paid');
    const updateCall = mockQuery.mock.calls[1][0];
    expect(updateCall).toMatch(/amount_paid = total/);
  });

  test('status change paid -> draft is rejected (immutability)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 10, status: 'paid' }] });
    const res = await request(buildInvoicesApp())
      .patch('/api/invoices/10/status')
      .send({ status: 'draft' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Cannot edit/);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('status change sent -> paid is rejected (use the payment endpoint)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 11, status: 'sent' }] });
    const res = await request(buildInvoicesApp())
      .patch('/api/invoices/11/status')
      .send({ status: 'paid' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid status transition/);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('status change sent -> cancelled is allowed', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 12, status: 'sent' }] })
      .mockResolvedValueOnce({ rows: [{ id: 12, status: 'cancelled' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(buildInvoicesApp())
      .patch('/api/invoices/12/status')
      .send({ status: 'cancelled' });
    expect(res.status).toBe(200);
    expect(res.body.invoice.status).toBe('cancelled');
  });

  test('status change on a missing invoice is 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildInvoicesApp())
      .patch('/api/invoices/999/status')
      .send({ status: 'cancelled' });
    expect(res.status).toBe(404);
  });
});

describe('P3-9-F01 loyalty redemption in the quote', () => {
  test('quote applies loyalty redemption identically to order placement', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 3, business_id: 42, display_name: 'Ox Burger Lab', status: 'active',
          accepts_online_orders: true, accepts_in_store_orders: true,
          currency_code: 'USD', prep_time_min: 12, operating_hours: null,
          timezone: 'America/New_York', fulfillment_modes: ['pickup', 'delivery'],
          tax_rate_bps: 0, service_fee_bps: 0, settings: {},
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 11, name: 'Classic Burger', price_cents: 899,
          currency_code: 'USD', is_available: true,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 55, points_balance: 500 }],
      });
    const res = await request(buildQuoteApp())
      .post('/api/food/restaurants/3/orders/quote')
      .send({
        orderSource: 'web',
        fulfillmentType: 'pickup',
        paymentMode: 'pay_at_restaurant',
        tipCents: 0,
        items: [{ menuItemId: 11, quantity: 1 }],
        loyaltyPointsToRedeem: 300,
      });
    expect(res.status).toBe(200);
    const quote = res.body.quote;
    expect(quote.loyaltyRedeemedPoints).toBe(300);
    expect(quote.loyaltyDiscountCents).toBe(300);
    expect(quote.discountCents).toBe(300);
    // 899 subtotal - 300 loyalty discount, no tax/fees/tip.
    expect(quote.totalCents).toBe(599);
  });

  test('quote without requested points has no loyalty lines', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 3, business_id: 42, display_name: 'Ox Burger Lab', status: 'active',
          accepts_online_orders: true, accepts_in_store_orders: true,
          currency_code: 'USD', prep_time_min: 12, operating_hours: null,
          timezone: 'America/New_York', fulfillment_modes: ['pickup', 'delivery'],
          tax_rate_bps: 0, service_fee_bps: 0, settings: {},
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 11, name: 'Classic Burger', price_cents: 899,
          currency_code: 'USD', is_available: true,
        }],
      });
    const res = await request(buildQuoteApp())
      .post('/api/food/restaurants/3/orders/quote')
      .send({
        orderSource: 'web',
        fulfillmentType: 'pickup',
        paymentMode: 'pay_at_restaurant',
        tipCents: 0,
        items: [{ menuItemId: 11, quantity: 1 }],
      });
    expect(res.status).toBe(200);
    expect(res.body.quote.loyaltyRedeemedPoints).toBe(0);
    expect(res.body.quote.loyaltyDiscountCents).toBe(0);
    expect(res.body.quote.totalCents).toBe(899);
  });
});

describe('P3-9-F02 redeemed points restored on refund', () => {
  const order = { id: 55, restaurant_id: 3, customer_id: 'cust-1' };

  test('restores redeemed points even when the order never completed', async () => {
    const client = fakeClient([
      { rows: [{ id: 77 }] }, // loyalty account
      { rows: [] }, // no 'order_completed' row (cancelled before completion)
      { rows: [{ redeemed_points: 200 }] }, // SUM of 'order_redeem' deductions
      { rows: [] }, // no 'order_redeem_restored' yet
      { rows: [] }, // UPDATE balance
      { rows: [] }, // INSERT restore ledger row
    ]);
    const result = await foodCtrl._clawBackFoodLoyaltyOnRefund(client, order);
    expect(result).toEqual({ accountId: 77, points: 0, restoredPoints: 200 });
    const updateCall = client.calls.find((c) => /UPDATE food_loyalty_accounts/.test(c.text));
    expect(updateCall.values).toEqual([200, 77]);
    const insertCall = client.calls.find((c) => /INSERT INTO food_loyalty_ledger/.test(c.text));
    expect(insertCall.values).toEqual([77, 55, 200]);
    expect(insertCall.text).toMatch(/order_redeem_restored/);
  });

  test('clawback plus restore when the order completed and redeemed', async () => {
    const client = fakeClient([
      { rows: [{ id: 77 }] },
      { rows: [{ id: 5, delta_points: 40 }] }, // 'order_completed' award
      { rows: [] }, // no 'order_refunded' yet
      { rows: [] }, // UPDATE balance (clawback)
      { rows: [] }, // INSERT 'order_refunded'
      { rows: [{ redeemed_points: 150 }] },
      { rows: [] }, // no restore yet
      { rows: [] }, // UPDATE balance (restore)
      { rows: [] }, // INSERT 'order_redeem_restored'
    ]);
    const result = await foodCtrl._clawBackFoodLoyaltyOnRefund(client, order);
    expect(result).toEqual({ accountId: 77, points: 40, restoredPoints: 150 });
  });

  test('restore is idempotent across retries', async () => {
    const client = fakeClient([
      { rows: [{ id: 77 }] },
      { rows: [] }, // no earn row
      { rows: [{ redeemed_points: 150 }] },
      { rows: [{ id: 9 }] }, // already restored
    ]);
    const result = await foodCtrl._clawBackFoodLoyaltyOnRefund(client, order);
    expect(result).toBeNull();
    expect(client.calls.filter((c) => /UPDATE food_loyalty_accounts/.test(c.text))).toHaveLength(0);
  });
});

describe('P3-9-F06/F15 earn gates and base', () => {
  const baseOrder = {
    id: 56, restaurant_id: 3, business_id: 42, customer_id: 'cust-1',
    subtotal_cents: 1000, discount_cents: 100, tip_cents: 200, tax_cents: 80,
    total_cents: 1180,
  };

  test('unpaid orders earn nothing', async () => {
    const client = fakeClient([]);
    const result = await foodCtrl._earnFoodLoyaltyOnComplete(client, {
      ...baseOrder, payment_status: 'unpaid',
    });
    expect(result).toBeNull();
    expect(client.query).not.toHaveBeenCalled();
  });

  test('paid orders earn on menu value only (excludes tip, tax, fees)', async () => {
    const client = fakeClient([
      // earn: upsert loyalty account
      { rows: [{ id: 78, lifetime_points: 9 }] },
      { rows: [] }, // ledger insert
      // profile upsert: no existing profile
      { rows: [] },
      // no business tiers defined
      { rows: [] },
      // order counts for count-based tier: first order -> 'new'
      { rows: [{ n: 1 }] },
      // profile insert
      { rows: [{ loyalty_tier: 'new' }] },
    ]);
    const result = await foodCtrl._earnFoodLoyaltyOnComplete(client, {
      ...baseOrder, payment_status: 'paid',
    });
    expect(result.id).toBe(78);
    // earn base = subtotal - discount = 900 -> 9 points (not floor(1180/100)=11)
    const accountUpsert = client.calls[0];
    expect(accountUpsert.values).toEqual([3, 'cust-1', 9]);
    const ledgerInsert = client.calls.find((c) => /INSERT INTO food_loyalty_ledger/.test(c.text));
    expect(ledgerInsert.text).toMatch(/order_completed/);
    expect(ledgerInsert.values).toEqual([78, 56, 9]);
  });
});
