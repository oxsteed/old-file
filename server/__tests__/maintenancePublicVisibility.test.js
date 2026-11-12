'use strict';

const { mockQuery, resetMocks } = require('./setup');
const maintenance = require('../controllers/maintenanceRequestController');

function response() {
  const res = {};
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  return res;
}

beforeEach(() => resetMocks());

test('public maintenance business lookup rejects non-live owner/business state', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  const res = response();
  const next = jest.fn();

  await maintenance.getPublicBusiness({ params: { businessId: '9' } }, res, next);

  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).toMatch(/b\.deleted_at IS NULL/);
  expect(sql).toMatch(/b\.setup_status = 'active'/);
  expect(sql).toMatch(/owner\.email_verified = TRUE/);
  expect(sql).toMatch(/owner\.onboarding_completed = TRUE/);
  expect(params).toEqual(['9']);
});
