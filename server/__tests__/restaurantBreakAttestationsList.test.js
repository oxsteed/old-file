'use strict';

// Domain 8 #31: GET /:restaurantId/break-attestations had zero callers
// anywhere — no reference in client/src, no other server file, no test.
// The handler is wired to a compliance list in the restaurant reports
// panel (ComplianceReportsSections), reusing the existing route.

jest.mock('../services/scopeModel', () => ({ resolveRestaurantAccess: jest.fn() }));
jest.mock('../services/permissionsService', () => ({ hasRestaurantPermission: jest.fn() }));
jest.mock('../services/restaurantLocationAccessService', () => ({ getLocationScope: jest.fn() }));
jest.mock('../db', () => ({ query: jest.fn() }));

const fs = require('fs');
const path = require('path');
const pool = require('../db');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const permissions = require('../services/permissionsService');
const { getLocationScope } = require('../services/restaurantLocationAccessService');
const compliance = require('../controllers/restaurantComplianceController');

const ATTESTATION_ROW = {
  id: 9,
  user_id: 'user-1',
  user_name: 'Ada Lovelace',
  time_entry_id: 44,
  entry_date: '2026-11-05',
  meal_break_taken: false,
  rest_break_taken: true,
  waived: true,
  waiver_reason: 'Single coverage',
  disputed: false,
  attested_at: '2026-11-05T18:00:00.000Z',
};

function runHandler(query = {}) {
  return new Promise((resolve, reject) => {
    const req = { params: { restaurantId: '7' }, query, user: { id: 'u-1' } };
    const res = { json: (body) => resolve({ status: 200, body }) };
    compliance.listBreakAttestations(req, res, (err) => (err ? resolve({ status: err.statusCode || 500, body: { code: err.code } }) : reject(new Error('no response'))));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resolveRestaurantAccess.mockResolvedValue({ id: 7, business_id: 42 });
  permissions.hasRestaurantPermission.mockResolvedValue(true);
  getLocationScope.mockResolvedValue({ mode: 'all' });
  pool.query.mockResolvedValue({ rows: [ATTESTATION_ROW] });
});

test('handler returns the latest attestation per entry for the report range', async () => {
  const { status, body } = await runHandler({ from: '2026-11-01', to: '2026-11-07' });
  expect(status).toBe(200);
  expect(body.attestations).toHaveLength(1);
  expect(body.attestations[0]).toMatchObject({ user_name: 'Ada Lovelace', entry_date: '2026-11-05', waived: true, disputed: false });
  const [sql, params] = pool.query.mock.calls[0];
  expect(String(sql)).toMatch(/FROM restaurant_break_attestations/);
  expect(params).toEqual(expect.arrayContaining([42, '2026-11-01', '2026-11-07']));
});

test('the reports panel calls the list endpoint (the route has a UI caller)', () => {
  const panel = fs.readFileSync(
    path.join(__dirname, '../../client/src/pages/food/RestaurantReportsPanel.jsx'),
    'utf8'
  );
  expect(panel).toContain('listBreakAttestations');
  const api = fs.readFileSync(
    path.join(__dirname, '../../client/src/api/restaurants.js'),
    'utf8'
  );
  expect(api).toContain('break-attestations');
});
