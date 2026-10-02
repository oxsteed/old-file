'use strict';

/**
 * Reproduction test for audit finding T12-F02.
 *
 * updateQuoteRequestAdmin defaulted an omitted currency to 'USD' and wrote it,
 * so a notes/status-only edit on a non-USD quote silently rewrote the stored
 * currency to USD. The fix: an omitted currency stays NULL (COALESCE preserves
 * the stored value); only an explicitly supplied currency is written, after
 * 3-letter validation.
 */

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/quoteRequestsController');

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

describe('T12-F02: quote currency preserved on unrelated edits', () => {
  test('notes-only edit does not pass a currency to the UPDATE', async () => {
    const updated = { id: 42, status: 'quoted', quote_currency_code: 'EUR', quote_amount_cents: 5000 };
    mockQuery.mockResolvedValueOnce({ rows: [updated] });

    const res = makeRes();
    await controller.updateQuoteRequestAdmin(
      {
        params: { id: '42' },
        body: { status: 'quoted', admin_notes: 'looks good' },
        user: { id: 1, role: 'admin' },
      },
      res
    );

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ request: updated }));
    // $4 is the currency param (status=$1, admin_notes=$2, amount=$3, currency=$4).
    const params = mockQuery.mock.calls[0][1];
    expect(params[3]).toBeNull();
  });

  test('explicit currency change is written after validation', async () => {
    const updated = { id: 42, status: 'quoted', quote_currency_code: 'EUR', quote_amount_cents: 5000 };
    mockQuery.mockResolvedValueOnce({ rows: [updated] });

    const res = makeRes();
    await controller.updateQuoteRequestAdmin(
      {
        params: { id: '42' },
        body: { status: 'quoted', quote_currency_code: 'eur' },
        user: { id: 1, role: 'admin' },
      },
      res
    );

    const params = mockQuery.mock.calls[0][1];
    expect(params[3]).toBe('EUR');
  });

  test('invalid currency is rejected with 400', async () => {
    const res = makeRes();
    await controller.updateQuoteRequestAdmin(
      {
        params: { id: '42' },
        body: { status: 'quoted', quote_currency_code: 'USDD' },
        user: { id: 1, role: 'admin' },
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
