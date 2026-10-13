'use strict';
const { mockQuery, resetMocks } = require('./setup');
const { loadCrossSurfaceBusy } = require('../services/crossSurfaceBusy');
const { computeSlots } = require('../services/bookingSlotEngine');

beforeEach(() => resetMocks());

const STAFF = '00000000-0000-4000-8000-0000000000aa';
// Next Monday 00:00 UTC, far enough ahead for advance rules.
const day = new Date(Date.UTC(2030, 0, 7));
const at = (h) => new Date(day.getTime() + h * 3600000).toISOString();

function businessDb({ shifts = [], cross = [], sameService = [], prep = 0 } = {}) {
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM business_services/.test(sql)) return { rows: [{ id: 1, business_id: 2, duration_minutes: 60, preparation_minutes: prep, max_capacity: 1, is_active: true, allow_online_booking: true }] };
    if (/FROM business_booking_rules/.test(sql)) return { rows: [{ min_advance_booking_hours: 0, max_advance_booking_days: 36500 }] };
    if (/FROM business_service_staff/.test(sql)) return { rows: [{ staff_id: STAFF }] };
    if (/FROM business_service_availability/.test(sql)) return { rows: [{ day_of_week: day.getUTCDay(), start_time: '09:00:00', end_time: '13:00:00', staff_id: STAFF }] };
    if (/FROM business_service_blocked_times/.test(sql)) return { rows: [] };
    if (/FROM business_staff_shifts/.test(sql)) return { rows: shifts };
    if (/service_id <> \$2/.test(sql)) return { rows: [] };
    if (/FROM business_appointments/.test(sql)) return { rows: sameService };
    if (/FROM appointments|FROM quote_requests/.test(sql)) return { rows: cross };
    return { rows: [] };
  });
  return computeSlots({ businessId: 2, serviceId: 1, from: at(0), to: at(24) });
}

describe('cross-surface scheduling (P1-192..195)', () => {
  test('a Direct visit for the same person blocks business slots (P1-192)', async () => {
    const { slots } = await businessDb({ cross: [{ user_id: STAFF, starts_at: at(10), ends_at: at(11), source: 'direct' }] });
    expect(slots.map((s) => s.start)).not.toContain(at(10));
    expect(slots.map((s) => s.start)).toContain(at(9));
  });

  test('staff with shifts are only bookable inside them (P1-193)', async () => {
    const { slots } = await businessDb({ shifts: [{ user_id: STAFF, shift_date: at(0).slice(0, 10), start_time: '11:00:00', end_time: '13:00:00' }] });
    expect(slots.map((s) => s.start)).toEqual([at(11), at(12)]);
  });

  test('preparation minutes pad existing appointments (P1-195)', async () => {
    const appt = [{ staff_id: STAFF, start_time: at(10), end_time: at(11), status: 'confirmed' }];
    const plain = await businessDb({ sameService: appt });
    expect(plain.slots.map((s) => s.start)).toEqual([at(9), at(11), at(12)]);
    const padded = await businessDb({ sameService: appt, prep: 15 });
    expect(padded.slots.map((s) => s.start)).toEqual([at(12)]);
  });

  test('loader can skip the caller\'s own surface', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await loadCrossSurfaceBusy([STAFF], at(0), at(1), { exclude: ['business', 'direct'] });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toMatch(/FROM appointments/);
  });
});
