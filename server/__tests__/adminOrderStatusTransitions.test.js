'use strict';

/**
 * adminOrderStatusTransitions.test.js — ADM-063
 *
 * markShipped must enforce the order status transition graph server-side:
 *  - paid -> processing (ships) and processing -> processing (idempotent
 *    tracking update) are allowed.
 *  - pending (unpaid), completed, cancelled, refunded -> 409 with
 *    order_invalid_status_transition. Unpaid orders must never ship, and
 *    completed/refunded orders must never regress to processing.
 */

const { mockQuery, resetMocks } = require('./setup');

const ctrl = require('../controllers/adminOrdersController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function mockReq(status) {
  return {
    params: { orderId: '7' },
    body: { trackingNumber: 'TRACK-1' },
    user: { id: 'admin-1' },
  };
}

function mockOrderFetch(status) {
  mockQuery.mockImplementation(async (sql) => {
    if (sql.includes('FROM marketplace_orders WHERE id')) {
      return { rows: [{ id: 7, status }] };
    }
    if (sql.includes('UPDATE marketplace_orders')) {
      return { rows: [{ id: 7, status: 'processing', shipped_at: new Date().toISOString(), tracking_number: 'TRACK-1' }] };
    }
    return { rows: [], rowCount: 0 };
  });
}

beforeEach(() => {
  resetMocks();
});

describe.each([
  ['pending', 409],
  ['completed', 409],
  ['cancelled', 409],
  ['refunded', 409],
])('markShipped from %s', (status, expectedStatus) => {
  test(`rejects with ${expectedStatus} and never updates the order`, async () => {
    mockOrderFetch(status);
    const res = mockRes();
    await ctrl.markShipped(mockReq(status), res);
    expect(res.status).toHaveBeenCalledWith(expectedStatus);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('order_invalid_status_transition');
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('UPDATE marketplace_orders'))).toBe(false);
  });
});

describe.each([['paid'], ['processing']])('markShipped from %s', (status) => {
  test('ships the order (200)', async () => {
    mockOrderFetch(status);
    const res = mockRes();
    await ctrl.markShipped(mockReq(status), res);
    expect(res.json).toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('processing');
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('UPDATE marketplace_orders'))).toBe(true);
  });
});
