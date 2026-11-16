'use strict';

jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../services/logisticsAuditService', () => ({ logLogisticsAction: jest.fn() }));

const pool = require('../db');
const { requireDeliveryActor } = require('../middleware/requireLogisticsAccess');
const warehouseService = require('../services/warehouseService');

function run(req) {
  let finish;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn((body) => finish({ body, res })),
  };
  return new Promise((resolve) => {
    finish = resolve;
    requireDeliveryActor()(req, res, (err) => resolve({ err, res }));
  });
}

beforeEach(() => jest.clearAllMocks());

test('assigned distributor can pass the delivery actor gate', async () => {
  pool.query.mockResolvedValue({ rows: [{ assigned_to: 'dist-1' }] });
  const { err } = await run({ user: { id: 'dist-1' }, params: { id: 'delivery-1' }, logisticsRole: 'reseller' });
  expect(err).toBeUndefined();
  expect(pool.query).toHaveBeenCalledWith('SELECT assigned_to FROM delivery_orders WHERE id = $1', ['delivery-1']);
});

test('revoked or changed assignment fails closed before a distributor update', async () => {
  pool.query.mockResolvedValue({ rows: [{ assigned_to: 'other-distributor' }] });
  const { res } = await run({ user: { id: 'dist-1' }, params: { id: 'delivery-1' }, logisticsRole: 'reseller' });
  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'delivery_assignment_required' }));
});

test('assigned distributors can read recipient-or-assigned delivery records', async () => {
  pool.query.mockResolvedValue({ rows: [{ id: 4, recipient_user_id: 'buyer-1', assigned_to: 'dist-1' }] });
  const delivery = await warehouseService.getDeliveryOrder(4, { userId: 'dist-1', allowAssigned: true });
  expect(delivery).toMatchObject({ id: 4, assigned_to: 'dist-1' });
  const [sql, params] = pool.query.mock.calls[0];
  expect(sql).toContain('d.assigned_to = $3');
  expect(params).toEqual([4, 'dist-1', 'dist-1']);
});
