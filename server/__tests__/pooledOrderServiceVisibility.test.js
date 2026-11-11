'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { listPooledOrders } = require('../services/pooledOrderService');

beforeEach(() => resetMocks());

test('public pooled campaigns require approved workflow state in count and rows queries', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ count: '0' }] })
    .mockResolvedValueOnce({ rows: [] });

  await listPooledOrders({ excludeDrafts: true, publicSafe: true, limit: 20, offset: 0 });

  expect(mockQuery.mock.calls[0][0]).toMatch(/po\.approval_state = 'approved'/);
  expect(mockQuery.mock.calls[1][0]).toMatch(/po\.approval_state = 'approved'/);
  expect(mockQuery.mock.calls[0][0]).toMatch(/po\.status <> 'draft'/);
  expect(mockQuery.mock.calls[1][0]).toMatch(/po\.status <> 'draft'/);
});
