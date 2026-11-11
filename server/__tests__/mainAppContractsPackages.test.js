'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { listPublicServicePackages } = require('../models/mainAppContractsModel');

beforeEach(() => resetMocks());

test('public service packages require a live listed business and onboarded owner', async () => {
  mockQuery.mockResolvedValue({ rows: [] });

  await expect(listPublicServicePackages({ businessId: 41, limit: 10 })).resolves.toEqual([]);

  const sql = mockQuery.mock.calls[0][0];
  expect(sql).toMatch(/JOIN businesses b ON b\.id = p\.business_id/);
  expect(sql).toMatch(/JOIN users owner ON owner\.id = b\.user_id/);
  expect(sql).toMatch(/b\.deleted_at IS NULL/);
  expect(sql).toMatch(/b\.is_listed = TRUE/);
  expect(sql).toMatch(/b\.business_kind = 'service'/);
  expect(sql).toMatch(/owner\.onboarding_completed = TRUE/);
});
