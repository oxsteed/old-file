'use strict';

/**
 * GET /bookings/helper/:helperId/available-slots must return the slot shape
 * BookingCalendar consumes: { startTime, endTime, available }.
 */

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));
jest.mock('../services/helperAvailabilityService', () => ({
  getHourSlots: jest.fn(),
  getHelperTimeZone: jest.fn().mockResolvedValue(null),
}));

const pool = require('../db');
const availabilityService = require('../services/helperAvailabilityService');
const bookingController = require('../controllers/bookingController');

function resMock() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe('getHelperAvailableSlots slot shape', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns startTime/endTime/available slots for BookingCalendar', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ '1': 1 }] }); // helper exists
    availabilityService.getHourSlots.mockResolvedValue({
      slots: [
        { startMin: 540, endMin: 600 },
        { startMin: 600, endMin: 660 },
      ],
      hasTemplate: true,
      dayHasAvailability: true,
      dayStatus: 'available',
      bookingBufferMinutes: 0,
    });

    const res = resMock();
    await bookingController.getHelperAvailableSlots(
      { params: { helperId: 'h1' }, query: { date: '2026-10-05' } },
      res,
      (e) => { throw e; },
    );

    expect(res.json).toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.slots).toEqual([
      { startTime: '09:00', endTime: '10:00', available: true },
      { startTime: '10:00', endTime: '11:00', available: true },
    ]);
    expect(payload.data.scheduleConfigured).toBe(true);
  });

  test('returns 404 for unknown helper', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // no helper

    const res = resMock();
    await bookingController.getHelperAvailableSlots(
      { params: { helperId: 'nope' }, query: { date: '2026-10-05' } },
      res,
      (e) => { throw e; },
    );

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('rejects missing, malformed, and impossible dates', async () => {
    pool.query.mockResolvedValue({ rows: [{ '1': 1 }] }); // helper exists

    for (const date of [undefined, '', 'not-a-date', '2026-13-01', '2026-02-30', '10/05/2026']) {
      const res = resMock();
      await bookingController.getHelperAvailableSlots(
        { params: { helperId: 'h1' }, query: { date } },
        res,
        (e) => { throw e; },
      );
      expect(res.status).toHaveBeenCalledWith(400);
      expect(availabilityService.getHourSlots).not.toHaveBeenCalled();
      jest.clearAllMocks();
      pool.query.mockResolvedValue({ rows: [{ '1': 1 }] });
    }
  });

  test('propagates the helper timezone into slot computation', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ '1': 1 }] }); // helper exists
    availabilityService.getHelperTimeZone.mockResolvedValueOnce('America/New_York');
    availabilityService.getHourSlots.mockResolvedValue({
      slots: [],
      hasTemplate: true,
      dayHasAvailability: true,
      dayStatus: 'available',
      bookingBufferMinutes: 0,
    });

    const res = resMock();
    await bookingController.getHelperAvailableSlots(
      { params: { helperId: 'h1' }, query: { date: '2026-10-05' } },
      res,
      (e) => { throw e; },
    );

    expect(availabilityService.getHelperTimeZone).toHaveBeenCalledWith(pool, 'h1');
    expect(availabilityService.getHourSlots).toHaveBeenCalledWith(
      'h1', '2026-10-05', 60, pool, 'America/New_York'
    );
  });
});
