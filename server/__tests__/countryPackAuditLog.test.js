'use strict';

/**
 * E12 — destructive admin actions are recorded in the audit log.
 * adminUpdateCountryPack must write a logAdminAction row with before/after.
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/countryPackService', () => ({
  normalizeCode: (c) => String(c).toUpperCase(),
  listAllCountryPacks: jest.fn(async () => [
    { code: 'US', name: 'United States', status: 'coming_soon' },
  ]),
  updateCountryPack: jest.fn(async () => ({ code: 'US', name: 'United States', status: 'active' })),
}));

const countryPackService = require('../services/countryPackService');
const { adminUpdateCountryPack } = require('../controllers/countryPackController');

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  mockQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
});

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

test('adminUpdateCountryPack writes an audit row with before/after', async () => {
  const req = {
    params: { code: 'us' },
    body: { status: 'active' },
    user: { id: 'admin-1' },
    ip: '127.0.0.1',
    get: () => null,
    correlationId: 'test-1',
  };
  const res = mockRes();
  const next = jest.fn();

  await adminUpdateCountryPack(req, res, next);

  expect(next).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ success: true })
  );

  // The audit row went through logAdminAction -> INSERT INTO admin_audit_log.
  const auditCall = mockQuery.mock.calls.find(([sql]) =>
    String(sql).includes('INSERT INTO admin_audit_log')
  );
  expect(auditCall).toBeDefined();
  const params = auditCall[1];
  // action, before.status=coming_soon, after.status=active are in the params.
  const flat = JSON.stringify(params);
  expect(flat).toContain('country_pack_update');
  expect(flat).toContain('coming_soon');
  expect(flat).toContain('active');
  expect(countryPackService.updateCountryPack).toHaveBeenCalled();
});
