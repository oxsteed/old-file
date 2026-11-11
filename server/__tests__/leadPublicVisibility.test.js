'use strict';

const { mockQuery, resetMocks } = require('./setup');
const leadController = require('../controllers/leadController');

function response() {
  const res = {};
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  return res;
}

beforeEach(() => resetMocks());

test('public lead intake rejects a business outside the live public contract', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  const res = response();

  await leadController.createLead(
    {
      params: { businessId: '7' },
      user: { id: 'customer-1' },
      body: { serviceIds: [9], description: 'Please quote this work' },
    },
    res,
  );

  expect(res.statusCode).toBe(404);
  expect(mockQuery.mock.calls).toHaveLength(1);
  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).toMatch(/b\.deleted_at IS NULL/);
  expect(sql).toMatch(/b\.is_listed = TRUE/);
  expect(sql).toMatch(/b\.setup_status = 'active'/);
  expect(sql).toMatch(/owner\.email_verified = TRUE/);
  expect(sql).toMatch(/owner\.onboarding_completed = TRUE/);
  expect(params).toEqual(['7']);
});
