'use strict';

// Phase 4 Track A (goal goal_a0fc7c0f0394): conflict validation at
// create, update, and swap approval. Blocking violations (overlap,
// approved time-off, minor limits) 409 with structured, keyed
// violations; availability mismatches warn only and never block the save.
//
// The pg mock defaults unqueued queries to { rows: [] }, so each test
// queues only the rows that matter and lets the rest default to empty.

const { mockQuery, resetMocks } = require('./setup');
// Legacy workforce contracts are exercised without a restaurant boundary here.
jest.mock('../services/restaurantWorkforceScope', () => ({
  ...jest.requireActual('../services/restaurantWorkforceScope'),
  context: jest.fn(async () => null),
}));
const ctrl = require('../controllers/businessStaffScheduleController');

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = undefined;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  return res;
}
const next = jest.fn();

const STAFF = '00000000-0000-4000-8000-0000000000aa';
const TARGET = '00000000-0000-4000-8000-0000000000bb';
const MANAGER = '00000000-0000-4000-8000-0000000000cc';

// 2026-10-14 is a Wednesday (day_of_week 3).
const DAY = '2026-10-14';

function createReq(overrides = {}) {
  return {
    params: { businessId: '2' },
    body: {
      user_id: STAFF,
      shift_start: `${DAY}T09:00`,
      shift_end: `${DAY}T17:00`,
      role: 'Cashier',
      ...overrides,
    },
  };
}

function codes(body) {
  return (body.violations || []).map((v) => v.code);
}

describe('shift conflict validation on create', () => {
  test('overlap with another shift blocks with a structured 409', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // membership
      .mockResolvedValueOnce({ rows: [{ id: 9, shift_date: DAY, start_time: '12:00:00', end_time: '20:00:00' }] }); // other shifts
    const res = mockRes();
    await ctrl.createShift(createReq(), res, next);

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('shift_conflicts');
    expect(codes(res.body)).toEqual(['shift_overlap']);
    const v = res.body.violations[0];
    expect(v.severity).toBe('blocking');
    expect(v.message_key).toBe('businessHub.staffScheduler.validation.shiftOverlap');
    expect(v).not.toHaveProperty('message');
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO business_staff_shifts/.test(sql))).toBe(false);
  });

  test('a shift ending when the next begins does not overlap', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // membership
      .mockResolvedValueOnce({ rows: [{ id: 9, shift_date: DAY, start_time: '17:00:00', end_time: '21:00:00' }] }) // other shifts
      .mockResolvedValueOnce({ rows: [] }) // approved time-off
      .mockResolvedValueOnce({ rows: [] }) // availability windows
      .mockResolvedValueOnce({ rows: [] }) // labor profile
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }); // insert
    const res = mockRes();
    await ctrl.createShift(createReq(), res, next);
    expect(res.statusCode).toBe(201);
  });

  test('approved time-off overlap blocks; only approved leave is checked', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // membership
      .mockResolvedValueOnce({ rows: [] }) // other shifts
      .mockResolvedValueOnce({ rows: [{ id: 3, request_type: 'vacation', start_date: DAY, end_date: '2026-10-16' }] }); // approved time-off
    const res = mockRes();
    await ctrl.createShift(createReq(), res, next);

    expect(res.statusCode).toBe(409);
    expect(codes(res.body)).toEqual(['time_off_overlap']);
    expect(res.body.violations[0].params.type).toBe('vacation');
    // The time-off query only ever sees approved requests: a pending
    // request can never produce this violation.
    const timeOffSql = mockQuery.mock.calls[2][0];
    expect(timeOffSql).toMatch(/status = 'approved'/);
  });

  test('availability outside the stored windows warns but the save succeeds', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // membership
      .mockResolvedValueOnce({ rows: [] }) // other shifts
      .mockResolvedValueOnce({ rows: [] }) // approved time-off
      // Wednesday window ends at noon; the 09:00-17:00 shift is not covered.
      .mockResolvedValueOnce({ rows: [{ day_of_week: 3, start_time: '09:00:00', end_time: '12:00:00' }] })
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }); // insert
    const res = mockRes();
    await ctrl.createShift(createReq(), res, next);

    expect(res.statusCode).toBe(201);
    expect(res.body.warnings).toHaveLength(1);
    expect(res.body.warnings[0].code).toBe('availability_outside_window');
    expect(res.body.warnings[0].severity).toBe('warning');
    expect(res.body.warnings[0].message_key).toBe('businessHub.staffScheduler.validation.availabilityOutsideWindow');
  });

  test('no availability record at all produces no warning', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // membership
      .mockResolvedValueOnce({ rows: [] }) // other shifts
      .mockResolvedValueOnce({ rows: [] }) // approved time-off
      .mockResolvedValueOnce({ rows: [] }) // availability windows
      .mockResolvedValueOnce({ rows: [] }) // labor profile
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }); // insert
    const res = mockRes();
    await ctrl.createShift(createReq(), res, next);
    expect(res.statusCode).toBe(201);
    expect(res.body.warnings).toBeUndefined();
  });

  test('minor daily hour limit blocks (jurisdiction preset, no hardcoded US rule)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // membership
      // 06:00-11:00 (5h) already scheduled; the 12:00-17:00 candidate
      // (5h) takes the day to 10h, over the 8h minor daily limit.
      .mockResolvedValueOnce({ rows: [{ id: 9, shift_date: DAY, start_time: '06:00:00', end_time: '11:00:00' }] })
      .mockResolvedValueOnce({ rows: [] }) // approved time-off
      .mockResolvedValueOnce({ rows: [] }) // availability windows
      .mockResolvedValueOnce({ rows: [{ minor_band: 'age_16_17', minor_until: '2030-01-01' }] }); // labor profile
    const res = mockRes();
    await ctrl.createShift(createReq({ shift_start: `${DAY}T12:00`, shift_end: `${DAY}T17:00` }), res, next);

    expect(res.statusCode).toBe(409);
    expect(codes(res.body)).toEqual(['minor_daily_hours']);
    expect(res.body.violations[0].params.limit).toBe(8);
  });

  test('minor latest end time blocks', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // membership
      .mockResolvedValueOnce({ rows: [] }) // other shifts
      .mockResolvedValueOnce({ rows: [] }) // approved time-off
      .mockResolvedValueOnce({ rows: [] }) // availability windows
      .mockResolvedValueOnce({ rows: [{ minor_band: 'age_16_17', minor_until: '2030-01-01' }] }); // labor profile
    const res = mockRes();
    await ctrl.createShift(createReq({ shift_start: `${DAY}T15:00`, shift_end: `${DAY}T23:00` }), res, next);

    expect(res.statusCode).toBe(409);
    expect(codes(res.body)).toEqual(['minor_latest_end']);
    expect(res.body.violations[0].params.limit).toBe('22:00');
  });

  test('under-16 school-day limit blocks', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // membership
      .mockResolvedValueOnce({ rows: [] }) // other shifts
      .mockResolvedValueOnce({ rows: [] }) // approved time-off
      .mockResolvedValueOnce({ rows: [] }) // availability windows
      .mockResolvedValueOnce({ rows: [{ minor_band: 'under_16', minor_until: '2030-01-01' }] }); // labor profile
    const res = mockRes();
    // Wednesday in October is a school day: the 3h under-16 daily cap
    // applies on top of the jurisdiction's 8h minor limit.
    await ctrl.createShift(createReq({ shift_start: `${DAY}T09:00`, shift_end: `${DAY}T17:00` }), res, next);

    expect(res.statusCode).toBe(409);
    expect(codes(res.body)).toContain('minor_under16_daily_hours');
  });

  test('happy path creates the shift with no violations or warnings', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // membership
      .mockResolvedValueOnce({ rows: [] }) // other shifts
      .mockResolvedValueOnce({ rows: [] }) // approved time-off
      .mockResolvedValueOnce({ rows: [] }) // availability windows
      .mockResolvedValueOnce({ rows: [] }) // labor profile
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }); // insert
    const res = mockRes();
    await ctrl.createShift(createReq(), res, next);
    expect(res.statusCode).toBe(201);
    expect(res.body.warnings).toBeUndefined();
  });
});

describe('shift conflict validation on update', () => {
  const currentRow = { id: 7, user_id: STAFF, shift_date: DAY, start_time: '09:00:00', end_time: '17:00:00' };

  test('moving a shift onto another shift blocks', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [currentRow] }) // current row
      .mockResolvedValueOnce({ rows: [{ id: 9, shift_date: DAY, start_time: '16:00:00', end_time: '20:00:00' }] }); // other shifts
    const res = mockRes();
    await ctrl.updateShift(
      { params: { businessId: '2', shiftId: '7' }, body: { shift_start: `${DAY}T10:00`, shift_end: `${DAY}T18:00` } },
      res, next
    );
    expect(res.statusCode).toBe(409);
    expect(codes(res.body)).toEqual(['shift_overlap']);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE business_staff_shifts/.test(sql))).toBe(false);
  });

  test('the shift being updated never conflicts with itself', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [currentRow] }) // current row
      .mockResolvedValueOnce({ rows: [{ id: 7, shift_date: DAY, start_time: '09:00:00', end_time: '17:00:00' }] }) // only itself
      .mockResolvedValueOnce({ rows: [] }) // approved time-off
      .mockResolvedValueOnce({ rows: [] }) // availability windows
      .mockResolvedValueOnce({ rows: [] }) // labor profile
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }); // update
    const res = mockRes();
    await ctrl.updateShift(
      { params: { businessId: '2', shiftId: '7' }, body: { shift_start: `${DAY}T10:00`, shift_end: `${DAY}T18:00` } },
      res, next
    );
    expect(res.statusCode).toBe(200);
  });

  test('a role-only edit skips validation and succeeds', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [currentRow] }) // current row
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }); // update
    const res = mockRes();
    await ctrl.updateShift(
      { params: { businessId: '2', shiftId: '7' }, body: { role: 'Lead' } },
      res, next
    );
    expect(res.statusCode).toBe(200);
    // No validation queries ran: only the current-row read and the update.
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});

describe('shift conflict validation: approved labor borrows (finding 37)', () => {
  const { validateShift } = require('../services/shiftConflictValidation');

  // Fake db keyed on SQL fragments, in order (same shape as the PTO
  // service tests). The borrow query only runs when the shift has a
  // restaurant context; these tests pass restaurantId explicitly.
  function fakeDb({ borrows = [] } = {}) {
    const calls = [];
    return {
      calls,
      query: jest.fn(async (sql, params) => {
        calls.push(String(sql));
        const s = String(sql);
        if (s.includes('FROM business_staff_shifts')) return { rows: [] };
        if (s.includes('FROM business_time_off_requests')) return { rows: [] };
        if (s.includes('FROM restaurant_labor_borrows')) return { rows: borrows };
        if (s.includes('FROM business_staff_availability')) return { rows: [] };
        if (s.includes('FROM business_staff_labor_profiles')) return { rows: [] };
        return { rows: [] };
      }),
    };
  }
  const baseOpts = {
    businessId: 2, userId: STAFF, shiftDate: DAY,
    startTime: '09:00', endTime: '17:00', restaurantId: 7,
  };

  test('an overlapping approved borrow blocks like an overlapping shift', async () => {
    const db = fakeDb({
      borrows: [{ id: 55, shift_date: DAY, start_time: '12:00:00', end_time: '20:00:00', borrow_location_id: 9 }],
    });
    const { violations, warnings } = await validateShift(db, baseOpts);
    expect(violations.map((v) => v.code)).toEqual(['borrow_overlap']);
    expect(violations[0].severity).toBe('blocking');
    expect(violations[0].message_key).toBe('businessHub.staffScheduler.validation.borrowOverlap');
    expect(violations[0].borrow_id).toBe(55);
    expect(violations[0].params.borrowDate).toBe(DAY);
    expect(warnings).toEqual([]);
    // Only approved borrows are ever read.
    expect(db.calls.find((sql) => sql.includes('restaurant_labor_borrows'))).toMatch(/status = 'approved'/);
  });

  test('a borrow at a non-overlapping time does not block', async () => {
    const db = fakeDb({
      borrows: [{ id: 55, shift_date: DAY, start_time: '17:00:00', end_time: '21:00:00', borrow_location_id: 9 }],
    });
    const { violations } = await validateShift(db, baseOpts);
    expect(violations).toEqual([]);
  });

  test('an overnight candidate overlapping the next morning borrow blocks', async () => {
    const db = fakeDb({
      borrows: [{ id: 56, shift_date: '2026-10-15', start_time: '02:00:00', end_time: '06:00:00', borrow_location_id: 9 }],
    });
    const { violations } = await validateShift(db, {
      ...baseOpts, startTime: '22:00', endTime: '06:00',
    });
    expect(violations.map((v) => v.code)).toEqual(['borrow_overlap']);
    expect(violations[0].params.borrowDate).toBe('2026-10-15');
  });

  test('no restaurant context means no borrow check runs', async () => {
    const db = fakeDb({
      borrows: [{ id: 55, shift_date: DAY, start_time: '12:00:00', end_time: '20:00:00', borrow_location_id: 9 }],
    });
    const { violations } = await validateShift(db, {
      businessId: 2, userId: STAFF, shiftDate: DAY, startTime: '09:00', endTime: '17:00',
    });
    expect(violations).toEqual([]);
    expect(db.calls.some((sql) => sql.includes('restaurant_labor_borrows'))).toBe(false);
  });
});

describe('shift conflict validation on swap approval', () => {
  function swapRow(overrides = {}) {
    return {
      id: 19, shift_id: 7, status: 'target_accepted',
      target_user_id: TARGET, assigned_user_id: STAFF,
      shift_date: DAY, start_time: '09:00:00', end_time: '17:00:00',
      location_id: null, restaurant_id: null,
      ...overrides,
    };
  }
  function approveReq() {
    return {
      params: { businessId: '2', requestId: '19' },
      user: { id: MANAGER },
      businessRole: 'manager',
    };
  }

  test('approval is blocked when the target already has an overlapping shift', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [swapRow()] }) // swap + shift
      .mockResolvedValueOnce({ rows: [{ id: 11, shift_date: DAY, start_time: '12:00:00', end_time: '20:00:00' }] }); // target's shifts
    const res = mockRes();
    await ctrl.approveShiftSwapRequest(approveReq(), res, next);

    expect(res.statusCode).toBe(409);
    expect(codes(res.body)).toEqual(['shift_overlap']);
    expect(res.body.violations[0].user_id).toBe(TARGET);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE business_staff_shifts SET user_id/.test(sql))).toBe(false);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE business_shift_swap_requests/.test(sql))).toBe(false);
  });

  test('approval succeeds after target acceptance when the target is clean', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [swapRow()] }) // swap + shift
      .mockResolvedValueOnce({ rows: [] }) // target's other shifts
      .mockResolvedValueOnce({ rows: [] }) // target's approved time-off
      .mockResolvedValueOnce({ rows: [] }) // target's availability windows
      .mockResolvedValueOnce({ rows: [] }) // target's labor profile
      .mockResolvedValueOnce({ rows: [] }) // shift reassignment
      .mockResolvedValueOnce({ rows: [{ id: 19, status: 'approved' }] }); // request close
    const res = mockRes();
    await ctrl.approveShiftSwapRequest(approveReq(), res, next);
    expect(res.statusCode).toBe(200);
    expect(res.body.request.status).toBe('approved');
  });
});
