'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { getPayRun } = require('../controllers/adminRestaurantPayRunsController');

const response = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() });

beforeEach(() => resetMocks());

test('surfaces payout-link read failures instead of returning an empty admin detail', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 7, restaurant_id: 3, restaurant_currency_code: 'USD' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockRejectedValueOnce(new Error('database unavailable'));

  const res = response();
  const next = jest.fn();
  await getPayRun({ params: { payRunId: '7' } }, res, next);

  expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'database unavailable' }));
  expect(res.json).not.toHaveBeenCalled();
});

test('keeps the missing-table fallback for older admin deployments', async () => {
  const missingTable = Object.assign(new Error('relation does not exist'), { code: '42P01' });
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 7, restaurant_id: 3, restaurant_currency_code: 'USD' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockRejectedValueOnce(missingTable);

  const res = response();
  const next = jest.fn();
  await getPayRun({ params: { payRunId: '7' } }, res, next);

  expect(next).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    payRun: expect.objectContaining({ payoutLinks: [], linkedPayoutCents: 0 }),
  }));
});
