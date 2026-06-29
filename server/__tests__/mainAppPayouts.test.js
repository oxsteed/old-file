'use strict';

const { mockQuery, resetMocks } = require('./setup');
const ctrl = require('../controllers/mainAppController');

function mockResponse() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => resetMocks());

describe('main app payout guardrails', () => {
  test('blocks platform-managed payout requests while withdrawals are coming soon', async () => {
    const req = {
      user: { id: '00000000-0000-4000-8000-000000000999' },
      body: {
        amountCents: 12500,
        currencyCode: 'USD',
        payoutMethod: 'bank_transfer',
      },
    };
    const res = mockResponse();
    const next = jest.fn();

    await ctrl.requestPayout(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'payouts_coming_soon',
        message: expect.stringContaining('Platform-managed withdrawals are coming soon'),
      },
    });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});

describe('main app promo launch scope', () => {
  test('returns promo vouchers scoped to restaurant-credit food orders', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 42,
          code: 'FOOD10',
          title: 'FOOD10',
          description: '10% off food credit orders',
          discount_type: 'percentage',
          discount_value: 10,
          end_date: null,
          category: 'food',
          status: 'active',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });
    const req = { user: { id: '00000000-0000-4000-8000-000000000999' } };
    const res = mockResponse();
    const next = jest.fn();

    await ctrl.getPromoWallet(req, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      promos: [expect.objectContaining({
        code: 'FOOD10',
        category: 'food',
        applicabilityNote: expect.stringContaining('restaurant-credit food orders'),
      })],
    }));
    expect(next).not.toHaveBeenCalled();
  });
});
