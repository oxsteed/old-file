'use strict';

// Tenant ids that arrive in the body/query (not the path) are outside the route
// scope guard; these pin the handlers that verify them (scope report Area 4).
const { mockQuery, resetMocks } = require('./setup');
jest.mock('../services/pooledOrderService', () => ({ joinPooledOrder: jest.fn(async () => ({ id: 'p1' })) }));
const pooledOrderService = require('../services/pooledOrderService');
const ctrl = require('../controllers/logisticsPooledOrdersController');

const USER = '00000000-0000-4000-8000-000000000001';
const call = async (body) => {
  const req = { params: { id: 'po-1' }, user: { id: USER }, body };
  const res = { json: jest.fn() };
  const next = jest.fn();
  await ctrl.joinPooledOrder(req, res, next);
  return { res, next };
};

beforeEach(() => { resetMocks(); pooledOrderService.joinPooledOrder.mockClear(); });

describe('pooled order pledge attributed to a business', () => {
  test('a business the caller has no standing on is refused before the pledge', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const { next } = await call({ committed_qty: 2, business_id: 77 });
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 404, code: 'business_not_found' });
    expect(pooledOrderService.joinPooledOrder).not.toHaveBeenCalled();
  });

  test('garbage ids are refused without a query', async () => {
    const { next } = await call({ committed_qty: 2, business_id: '1 OR 1=1' });
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 404 });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('members pledge for their business; personal pledges need no business', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5, effective_role: 'representative', deleted_at: null }] });
    const ok = await call({ committed_qty: 2, business_id: 5 });
    expect(ok.res.json).toHaveBeenCalled();
    const personal = await call({ committed_qty: 1 });
    expect(personal.res.json).toHaveBeenCalled();
    expect(pooledOrderService.joinPooledOrder).toHaveBeenCalledTimes(2);
  });
});
