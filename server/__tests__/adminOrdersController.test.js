'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { getOrders } = require('../controllers/adminOrdersController');

beforeEach(() => {
  resetMocks();
});

describe('admin order listing', () => {
  test('uses the same customer-aware filters for rows and totals', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] });

    const json = jest.fn();
    await getOrders({ query: { search: 'customer@example.com' } }, { json });

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const countSql = mockQuery.mock.calls[1][0];
    expect(countSql).toContain('JOIN users u ON mo.customer_id = u.id');
    expect(countSql).toContain('u.email ILIKE');
    expect(countSql).toContain('u.first_name ILIKE');
    expect(countSql).not.toContain('customer_id ILIKE');
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      pagination: expect.objectContaining({ total: 0, limit: 20, skip: 0 }),
    }));
  });
});
