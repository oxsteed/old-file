'use strict';

// Review P3-786: the payout surface keys on req.user.id (auth never sets helper_id).
const { mockQuery, resetMocks } = require('./setup');
const P = require('../controllers/PayoutController');

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
beforeEach(() => resetMocks());

test('lists payout methods for the signed-in user', async () => {
  mockQuery.mockResolvedValue({ rows: [] });
  await P.getPayoutMethods({ user: { id: 'u1' }, query: {} }, res());
  expect(mockQuery.mock.calls[0][1]).toContain('u1');
});

test('creates a payout method owned by the signed-in user', async () => {
  mockQuery.mockResolvedValue({ rows: [{ id: 'm1' }] });
  const r = res();
  await P.createPayoutMethod({ user: { id: 'u1' }, body: { method_type: 'bank_account' } }, r);
  const insert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO payout_methods/.test(sql));
  expect(insert[1][0]).toBe('u1');
  expect(r.status).toHaveBeenCalledWith(201);
});

test('rejects unknown method types before touching the database', async () => {
  const r = res();
  await P.createPayoutMethod({ user: { id: 'u1' }, body: { method_type: 'bank_transfer' } }, r);
  expect(mockQuery).not.toHaveBeenCalled();
  expect(r.status).toHaveBeenCalledWith(400);
});

test('payout history is scoped through the user\'s affiliate programs', async () => {
  mockQuery.mockResolvedValue({ rows: [{}] });
  await P.getPayouts({ user: { id: 'u1' }, query: {} }, res());
  expect(mockQuery.mock.calls[0][0]).toMatch(/affiliate_programs WHERE helper_id = \$1/);
  expect(mockQuery.mock.calls[0][1][0]).toBe('u1');
});
