'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/oxsteedCreditAdminService', () => ({
  listSettlements: jest.fn(),
}));

const pool = require('../db');
const { listSettlements } = require('../services/oxsteedCreditAdminService');
const controller = require('../controllers/oxsteedCreditPartnerController');

function buildResponse() {
  return {
    json: jest.fn(),
    set: jest.fn(),
    send: jest.fn(),
  };
}

describe('OxSteed Credit partner controller authorization', () => {
  beforeEach(() => {
    pool.query.mockReset();
    listSettlements.mockReset();
  });

  test('rejects a restaurant member without owner or manager role', async () => {
    const req = { user: { id: 'staff-1' }, params: { restaurantId: '42' }, query: {} };
    const res = buildResponse();
    const next = jest.fn();
    pool.query.mockResolvedValueOnce({ rows: [{ id: 42, effective_role: 'staff' }] });

    await controller.listPartnerTransactions(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'forbidden', status: 403 }));
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(res.json).not.toHaveBeenCalled();
  });

  test('scopes an authorized manager query to that restaurant partner', async () => {
    const req = { user: { id: 'manager-1' }, params: { restaurantId: '42' }, query: { limit: '10', offset: '0' } };
    const res = buildResponse();
    const next = jest.fn();
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 42, effective_role: 'manager' }] })
      .mockResolvedValueOnce({ rows: [{ id: 9, status: 'active', settlement_currency_code: 'USD' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'tx-1', transaction_type: 'purchase', status: 'posted', amount_cents: '1250', currency_code: 'USD', agreement_id: 'agreement-1', reference_type: 'food_order', reference_id: 'order-1', description: 'Lunch', posted_at: '2026-09-14T12:00:00.000Z', created_at: '2026-09-14T12:00:00.000Z' }] });

    await controller.listPartnerTransactions(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      partnerId: '9',
      partnerStatus: 'active',
      transactions: [expect.objectContaining({ id: 'tx-1', amountCents: 1250, currencyCode: 'USD' })],
    }));
    expect(pool.query.mock.calls[2][1]).toEqual([9, 'USD', 11, 0]);
  });
});
