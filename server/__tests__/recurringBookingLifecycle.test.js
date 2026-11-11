'use strict';

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue(undefined),
}));

const controller = require('../controllers/bookingController');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => resetMocks());

describe('recurring booking account lifecycle guards', () => {
  test('does not list subscriptions for inactive or soft-deleted helpers', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await controller.listRecurringBookings({ user: { id: 'customer-1' } }, mockRes());

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/u\.is_active = TRUE/);
    expect(sql).toMatch(/u\.deleted_at IS NULL/);
  });

  test('rejects creating a recurring booking for a soft-deleted helper', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'helper-1', is_active: true, deleted_at: new Date(), role: 'helper' }],
    });

    const res = mockRes();
    await controller.createRecurringBooking({
      user: { id: 'customer-1' },
      body: {
        helper_id: 'helper-1',
        service_name: 'Weekly cleaning',
        frequency: 'weekly',
        preferred_day: 'monday',
      },
    }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'HELPER_NOT_FOUND' }));
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO recurring_booking_subscriptions/.test(sql))).toBe(false);
  });
});
