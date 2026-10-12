'use strict';
const { mockQuery, resetMocks } = require('./setup');
const ctrl = require('../controllers/jobController');

beforeEach(resetMocks);

test('helper cannot complete an escrow job while the payment is still authorized (P1-138)', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 'j1', client_id: 'c1', assigned_helper_id: 'h1', status: 'in_progress', transaction_mode: 'guided_protected' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'pay1' }] });
  const next = jest.fn();
  const res = { json: jest.fn(), status: jest.fn(() => res) };
  await ctrl.completeJob({ params: { id: 'j1' }, user: { id: 'h1' }, body: {} }, res, next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'customer_confirmation_required' }));
  expect(mockQuery.mock.calls.some(([sql]) => /UPDATE jobs SET/.test(sql))).toBe(false);
});
