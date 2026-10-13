'use strict';
const { mockQuery, resetMocks } = require('./setup');
const ctrl = require('../controllers/jobController');

beforeEach(resetMocks);

// P1-138 (superseded by W3 P2-478): a helper's completion on an escrow job with
// an authorized payment is only a request the customer confirms; it never
// flips the job to `completed` while the funds are still held.
test('helper cannot complete an escrow job while the payment is still authorized (P1-138)', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 'j1', client_id: 'c1', assigned_helper_id: 'h1', status: 'in_progress', transaction_mode: 'guided_protected' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'pay1' }] })
    .mockResolvedValue({ rows: [], rowCount: 0 });
  const next = jest.fn();
  const res = { json: jest.fn(), status: jest.fn(() => res) };
  await ctrl.completeJob({ params: { id: 'j1' }, user: { id: 'h1' }, body: {} }, res, next);
  expect(mockQuery.mock.calls.some(([sql]) => /SET\s+status\s*=\s*'completed'/.test(String(sql)))).toBe(false);
  expect(res.json.mock.calls.some(([b]) => b && b.message === 'Job completed')).toBe(false);
});
