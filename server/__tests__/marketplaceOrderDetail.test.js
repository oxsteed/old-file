'use strict';

// Buyer-scoped marketplace order detail: the order lookup must be scoped to
// the requesting buyer in SQL, and another buyer's order must be
// indistinguishable from a missing order (same 404).
const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/cartCheckoutController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => resetMocks());

test('own order returns order, items, and latest payment', async () => {
  const orderRow = { id: 42, customer_id: 7, total_cents: 2500, status: 'paid' };
  mockQuery
    .mockResolvedValueOnce({ rows: [orderRow] })
    .mockResolvedValueOnce({ rows: [{ id: 1, product_name: 'Widget', quantity: 2 }] })
    .mockResolvedValueOnce({ rows: [{ payment_intent_id: 'pi_1', status: 'succeeded' }] });
  const res = mockRes();
  await controller.getMarketplaceOrder({ user: { id: 7 }, params: { orderId: '42' } }, res);
  expect(res.json).toHaveBeenCalledWith({
    success: true,
    data: {
      order: orderRow,
      items: [{ id: 1, product_name: 'Widget', quantity: 2 }],
      payment: { payment_intent_id: 'pi_1', status: 'succeeded' },
    },
  });
  const [orderSql, orderArgs] = mockQuery.mock.calls[0];
  expect(orderSql).toMatch(/WHERE id = \$1 AND customer_id = \$2/);
  expect(orderArgs).toEqual(['42', 7]);
});

test("another buyer's order returns 404 without revealing it", async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  const res = mockRes();
  await controller.getMarketplaceOrder({ user: { id: 7 }, params: { orderId: '99' } }, res);
  expect(res.status).toHaveBeenCalledWith(404);
  expect(mockQuery).toHaveBeenCalledTimes(1);
});

test('missing order returns 404', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  const res = mockRes();
  await controller.getMarketplaceOrder({ user: { id: 7 }, params: { orderId: '12345' } }, res);
  expect(res.status).toHaveBeenCalledWith(404);
});

test('unauthenticated request returns 401 without querying', async () => {
  const res = mockRes();
  await controller.getMarketplaceOrder({ user: null, params: { orderId: '42' } }, res);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(mockQuery).not.toHaveBeenCalled();
});
