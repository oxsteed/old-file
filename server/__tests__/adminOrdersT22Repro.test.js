'use strict';

/**
 * Reproduction tests for audit findings T22-F01 and T22-F02.
 *
 * T22-F01: markShipped/cancelOrder called withTransaction(callback) but the
 * helper requires withTransaction(pool, operation, name). The callback was
 * treated as the pool.
 *
 * T22-F02: getOrder returned 409 for refunded orders, blocking read-only
 * investigation of resolved financial cases.
 */

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/adminOrdersController');

// Real helper for transaction-semantics tests (the setup mocks withTransaction
// to skip BEGIN/COMMIT, so we reach past the mock for these).
const { withTransaction: realWithTransaction } = jest.requireActual('../utils/transaction');

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('T22-F01: shipping/cancellation transaction contract', () => {
  test('markShipped completes the shipment (withTransaction receives pool + operation)', async () => {
    const order = { id: 7, status: 'paid' };
    mockQuery
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rows: [{ ...order, status: 'processing' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = makeRes();
    await controller.markShipped(
      { params: { orderId: '7' }, body: { trackingNumber: '1Z999' }, user: { id: 1 } },
      res
    );

    // The setup's withTransaction mock is (pool, operation) => operation(client).
    // With the old withTransaction(callback) call, operation was undefined and
    // this threw; success proves the (pool, operation, name) contract holds.
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const updateSql = mockQuery.mock.calls.map(c => c[0]).find(s => s.includes('UPDATE marketplace_orders'));
    expect(updateSql).toContain("status = 'processing'");
  });

  test('cancelOrder completes the cancellation (withTransaction receives pool + operation)', async () => {
    const order = { id: 9, status: 'pending' };
    mockQuery
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rows: [{ ...order, status: 'cancelled' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = makeRes();
    await controller.cancelOrder(
      { params: { orderId: '9' }, body: { reason: 'customer request' }, user: { id: 1 } },
      res
    );

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const updateSql = mockQuery.mock.calls.map(c => c[0]).find(s => s.includes('UPDATE marketplace_orders'));
    expect(updateSql).toContain("status = 'cancelled'");
  });

  test('real withTransaction commits on success', async () => {
    const seen = [];
    const fakeClient = {
      query: jest.fn(async (text) => { seen.push(text); return { rows: [] }; }),
      release: jest.fn(),
    };
    const fakePool = { connect: jest.fn().mockResolvedValue(fakeClient) };

    const result = await realWithTransaction(fakePool, async (c) => {
      await c.query('UPDATE t SET x = 1');
      return 'ok';
    }, 'test_op');

    expect(result).toBe('ok');
    expect(seen).toEqual(['BEGIN', 'UPDATE t SET x = 1', 'COMMIT']);
    expect(fakeClient.release).toHaveBeenCalled();
  });

  test('real withTransaction rolls back on failure', async () => {
    const seen = [];
    const fakeClient = {
      query: jest.fn(async (text) => {
        seen.push(text);
        if (text.startsWith('UPDATE')) throw new Error('db exploded');
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const fakePool = { connect: jest.fn().mockResolvedValue(fakeClient) };

    await expect(realWithTransaction(fakePool, async (c) => {
      await c.query('UPDATE t SET x = 1');
    }, 'test_op')).rejects.toThrow('db exploded');

    expect(seen).toEqual(['BEGIN', 'UPDATE t SET x = 1', 'ROLLBACK']);
    expect(fakeClient.release).toHaveBeenCalled();
  });
});

describe('T22-F02: refunded order detail remains investigable', () => {
  test('getOrder returns 200 with full detail for a refunded order', async () => {
    const now = new Date().toISOString();
    const order = {
      id: 5, status: 'refunded', customer_id: 2, email: 'buyer@example.com',
      first_name: 'A', last_name: 'B', phone_number: null,
      subtotal_cents: 1000, tax_cents: 0, shipping_cents: 0,
      discount_cents: 0, total_cents: 1000, shipping_address: null,
      tracking_number: '1Z1', shipped_at: now,
      refunded_at: now, refund_reason: 'damaged',
      created_at: now, updated_at: now,
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = makeRes();
    await controller.getOrder({ params: { orderId: '5' } }, res);

    expect(res.status).not.toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ id: 5, status: 'refunded' }),
    }));
  });
});
