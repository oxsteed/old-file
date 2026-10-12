'use strict';

// Review P3-890: async Checkout outcomes reach food orders and QR payments.
const { mockQuery, resetMocks } = require('./setup');
const webhook = require('../controllers/webhookController');

beforeEach(() => resetMocks());

test('async failure marks an unpaid food order failed and the QR payment failed', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 7, payment_status: 'failed' }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [], rowCount: 1 });
  const out = await webhook.applyCheckoutSessionNotPaid(
    { id: 'cs_1', metadata: { food_order_id: '7' } }, 'failed');
  expect(out).toEqual({ food: 1, qr: 1 });
  const [foodSql, foodArgs] = mockQuery.mock.calls[0];
  expect(foodSql).toMatch(/payment_status IN \('unpaid', 'requires_payment'\)/);
  expect(foodArgs).toEqual([7]);
  expect(mockQuery.mock.calls[1][1]).toEqual(['cs_1', 'failed']);
  expect(mockQuery.mock.calls[1][0]).toMatch(/status = 'pending'/);
});

test('expiry without a food order only expires the pending QR payment', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
  const out = await webhook.applyCheckoutSessionNotPaid({ id: 'cs_2', metadata: {} }, 'expired');
  expect(out).toEqual({ food: 0, qr: 0 });
  expect(mockQuery).toHaveBeenCalledTimes(1);
  expect(mockQuery.mock.calls[0][1]).toEqual(['cs_2', 'expired']);
});

test('webhook routes async outcomes and never downgrades a paid order', () => {
  const src = require('fs').readFileSync(require.resolve('../controllers/webhookController.js'), 'utf8');
  expect(src).toMatch(/case 'checkout\.session\.async_payment_succeeded':/);
  expect(src).toMatch(/case 'checkout\.session\.async_payment_failed':/);
  expect(src).toMatch(/case 'checkout\.session\.expired':/);
  expect(src).toMatch(/NOT \(\$1 IN \('requires_payment', 'unpaid'\) AND payment_status IN \('paid', 'refunded'\)\)/);
});
