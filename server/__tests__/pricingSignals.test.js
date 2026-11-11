'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { getCustomerSegment, _clearCaches } = require('../services/pricingSignals');

const INPUT = { userId: 'user-1', businessId: 42 };

beforeEach(() => {
  resetMocks();
  _clearCaches();
});

test('database failure does not classify a customer as new', async () => {
  mockQuery.mockRejectedValue(new Error('database connection lost'));

  await expect(getCustomerSegment(INPUT)).resolves.toBe('unknown');
});

test('missing optional loyalty table remains compatible with interaction counts', async () => {
  const missingTable = Object.assign(new Error('relation does not exist'), { code: '42P01' });
  mockQuery
    .mockRejectedValueOnce(missingTable)
    .mockResolvedValueOnce({ rows: [{ appt_count: 2, order_count: 0 }] });

  await expect(getCustomerSegment(INPUT)).resolves.toBe('returning');
});

