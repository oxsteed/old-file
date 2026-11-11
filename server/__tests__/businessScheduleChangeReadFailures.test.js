'use strict';

const { mockQuery, resetMocks } = require('./setup');
const laborJurisdiction = require('../services/laborJurisdictionRules');
const { _recordScheduleChange } = require('../controllers/businessStaffScheduleController');

const before = {
  id: 4,
  published_at: '2026-11-01T00:00:00.000Z',
  user_id: '11111111-1111-4111-8111-111111111111',
  restaurant_id: 7,
  location_id: 8,
  shift_date: '2026-11-20',
  start_time: '10:00:00',
  end_time: '12:00:00',
};

beforeEach(() => {
  resetMocks();
  jest.spyOn(laborJurisdiction, 'getJurisdiction').mockResolvedValue({});
  jest.spyOn(laborJurisdiction, 'evaluateChange').mockReturnValue({
    premium_due: true,
    premium_hours: 1,
    premium_cents: null,
    hours_before_start: 1,
    notice_hours: 1,
    jurisdiction_code: 'US-CA',
  });
});

afterEach(() => jest.restoreAllMocks());

test('schedule premium read failures do not write an under-specified premium', async () => {
  mockQuery.mockRejectedValue(new Error('database connection lost'));

  await expect(_recordScheduleChange(
    { body: {}, user: { id: 'manager-1' } },
    { businessId: 11, before, after: { ...before, end_time: '13:00:00' }, changeType: 'edited' },
  )).rejects.toThrow('database connection lost');
  expect(mockQuery.mock.calls.some(([sql]) => sql.includes('INSERT INTO business_staff_schedule_changes'))).toBe(false);
});

