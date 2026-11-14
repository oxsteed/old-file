'use strict';

// Domain 8 #32: GET /:brandId/pay-runs/consolidations/:consolidationId
// (detail) had zero callers — the API wrapper getPayRunConsolidation
// was added in this delta and never imported by any page. BrandHQPanel
// now opens a consolidation detail view from the consolidations list.

jest.mock('../controllers/restaurantBrandController', () => ({
  loadBrandRestaurants: jest.fn(async () => [{ restaurant: { id: 1 } }]),
  brandIdParam: (req) => {
    const id = Number(req.params.brandId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Brand not found');
    return id;
  },
}));

const fs = require('fs');
const path = require('path');
const consolidations = require('../services/restaurantPayRunConsolidationService');
const controller = require('../controllers/restaurantPayRunConsolidationController');

const DETAIL_ROW = {
  id: 5,
  brand_id: 2,
  anchor_restaurant_id: 1,
  period_from: '2026-10-01',
  period_to: '2026-10-15',
  status: 'finalized',
  totals: { currency: 'USD', totalCents: 123456 },
  created_by: 'user-1',
  finalized_by: 'user-2',
  finalized_at: '2026-10-16T10:00:00.000Z',
  approved_by: null,
  approved_at: null,
  created_at: '2026-10-15T10:00:00.000Z',
  updated_at: '2026-10-16T10:00:00.000Z',
  members: [
    { pay_run_id: 11, restaurant_id: 1, location_ids: [3], currency_code: 'USD', totals: { grossCents: 60000 }, run_status: 'finalized', run_approved_by: 'user-2', period_from: '2026-10-01', period_to: '2026-10-15' },
    { pay_run_id: 12, restaurant_id: 1, location_ids: [4], currency_code: 'USD', totals: { grossCents: 63456 }, run_status: 'finalized', run_approved_by: 'user-2', period_from: '2026-10-01', period_to: '2026-10-15' },
  ],
};

function runHandler() {
  return new Promise((resolve, reject) => {
    const req = { params: { brandId: '2', consolidationId: '5' }, query: {}, user: { id: 'u-1' } };
    const res = { json: (body) => resolve({ status: 200, body }) };
    controller.getConsolidation(req, res, (err) => (err ? resolve({ status: err.statusCode || 500, body: { code: err.code, error: err.message } }) : reject(new Error('no response'))));
  });
}

test('detail handler returns the consolidation with its member pay runs', async () => {
  jest.spyOn(consolidations, 'getConsolidation').mockResolvedValue(DETAIL_ROW);
  const { status, body } = await runHandler();
  expect(status).toBe(200);
  expect(body.consolidation).toMatchObject({ id: 5, brandId: 2, status: 'finalized', periodFrom: '2026-10-01', periodTo: '2026-10-15' });
  expect(body.consolidation.members).toHaveLength(2);
  expect(body.consolidation.members.map((m) => m.payRunId)).toEqual([11, 12]);
  expect(consolidations.getConsolidation).toHaveBeenCalledWith(expect.anything(), { consolidationId: '5', brandId: 2 });
});

test('BrandHQPanel opens the detail from the consolidations list', () => {
  const panel = fs.readFileSync(
    path.join(__dirname, '../../client/src/pages/food/BrandHQPanel.jsx'),
    'utf8'
  );
  expect(panel).toContain('getPayRunConsolidation');
  expect(panel).toContain('consolidationDetail');
});
