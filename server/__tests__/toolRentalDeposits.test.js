'use strict';

// Review W6: P3-1068 tool-rental deposits.
const { mockQuery, resetMocks } = require('./setup');
const ctrl = require('../controllers/invoiceController');

function res() {
  const r = { statusCode: 200 };
  r.status = jest.fn((c) => { r.statusCode = c; return r; });
  r.json = jest.fn((b) => { r.body = b; return r; });
  return r;
}
const req = (body, id = '5') => ({ params: { bookingId: id }, body, user: { id: 'owner-1' } });

beforeEach(() => resetMocks());

test('deposit amount comes from the agreement snapshot only when required', () => {
  expect(ctrl.bookingDepositAmount({ agreement_snapshot: { tool: { requiresDeposit: true, depositAmount: 75.5 } } })).toBe(75.5);
  expect(ctrl.bookingDepositAmount({ agreement_snapshot: { tool: { requiresDeposit: false, depositAmount: 75 } } })).toBe(0);
  expect(ctrl.bookingDepositAmount({})).toBe(0);
});

test('owner returns a held deposit', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 5, owner_id: 'owner-1', status: 'completed', deposit_amount: '50.00', deposit_status: 'held' }] })
    .mockResolvedValueOnce({ rows: [{ id: 5, deposit_status: 'returned' }] });
  const r = res();
  await ctrl.resolveDeposit(req({ action: 'return' }), r);
  expect(r.body.deposit_status).toBe('returned');
  expect(mockQuery.mock.calls[1][1]).toEqual([5, 'returned', 0, null]);
});

test('withholding needs a reason and an amount within the deposit', async () => {
  const held = { rows: [{ id: 5, owner_id: 'owner-1', status: 'completed', deposit_amount: '50.00', deposit_status: 'held' }] };
  mockQuery.mockResolvedValueOnce(held);
  let r = res();
  await ctrl.resolveDeposit(req({ action: 'withhold', amount: 20, note: 'short' }), r);
  expect(r.body.code).toBe('note_required');

  mockQuery.mockResolvedValueOnce(held);
  r = res();
  await ctrl.resolveDeposit(req({ action: 'withhold', amount: 80, note: 'scratched housing and missing bit' }), r);
  expect(r.body.code).toBe('invalid_amount');

  mockQuery.mockResolvedValueOnce(held).mockResolvedValueOnce({ rows: [{ id: 5, deposit_status: 'partially_withheld' }] });
  r = res();
  await ctrl.resolveDeposit(req({ action: 'withhold', amount: 20, note: 'scratched housing and missing bit' }), r);
  expect(mockQuery.mock.calls.at(-1)[1].slice(1, 3)).toEqual(['partially_withheld', 20]);
});

test('only the owner of a held deposit can resolve it', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 5, owner_id: 'someone-else', deposit_status: 'held', status: 'completed' }] });
  let r = res();
  await ctrl.resolveDeposit(req({ action: 'return' }), r);
  expect(r.statusCode).toBe(404);
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 5, owner_id: 'owner-1', deposit_status: 'due', status: 'invoice_sent' }] });
  r = res();
  await ctrl.resolveDeposit(req({ action: 'return' }), r);
  expect(r.body.code).toBe('deposit_not_held');
});
