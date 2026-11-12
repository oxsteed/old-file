'use strict';

const { mockQuery, resetMocks } = require('./setup');
const beauty = require('../controllers/beautyOperationsController');
const continuity = require('../controllers/continuityOperationsController');

beforeEach(() => resetMocks());

function requestFor(handler) {
  const next = jest.fn();
  return handler(
    { params: { businessId: '7' }, body: {} },
    {},
    next,
  ).then(() => next);
}

test.each([
  ['beauty public workspace', beauty.getPublicWorkspace],
  ['beauty public intake', beauty.createIntakeRequest],
  ['continuity public workspace', continuity.getPublicWorkspace],
  ['continuity public intake', continuity.createIntakeRequest],
])('%s rejects a business outside the live public contract', async (_label, handler) => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  const next = await requestFor(handler);

  expect(next).toHaveBeenCalledTimes(1);
  expect(next.mock.calls[0][0]).toMatchObject({ status: 404, code: 'not_found' });
  expect(mockQuery).toHaveBeenCalledTimes(1);
  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).toMatch(/b\.deleted_at IS NULL/);
  expect(sql).toMatch(/b\.is_listed = TRUE/);
  expect(sql).toMatch(/b\.setup_status = 'active'/);
  expect(sql).toMatch(/owner\.email_verified = TRUE/);
  expect(sql).toMatch(/owner\.onboarding_completed = TRUE/);
  expect(params).toEqual(['7']);
});
