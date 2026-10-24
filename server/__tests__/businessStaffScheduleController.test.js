'use strict';

// Review P1-5-F02: the StaffScheduler write path must produce rows the
// booking slot engine reads (shift_date/start_time/end_time per migration
// 238), never the legacy shift_start/shift_end columns.

const { mockQuery, resetMocks } = require('./setup');
// Legacy workforce contracts are exercised without a restaurant boundary here.
// The full-schema store suite covers the actual scope resolver.
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

describe('businessStaffScheduleController shifts (P1-5-F02)', () => {
  test('createShift writes the slot-engine schema, not legacy columns', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // membership check
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }); // insert
    const req = {
      params: { businessId: '2' },
      body: {
        user_id: '00000000-0000-4000-8000-0000000000aa',
        shift_start: '2026-10-14T09:00',
        shift_end: '2026-10-14T17:00',
        role: 'Cashier',
        notes: 'Front counter',
      },
    };
    const res = mockRes();
    await ctrl.createShift(req, res, next);

    expect(res.statusCode).toBe(201);
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toMatch(/INSERT INTO business_staff_shifts/);
    expect(sql).toContain('shift_date');
    expect(sql).toContain('start_time');
    expect(sql).toContain('end_time');
    expect(sql).not.toMatch(/shift_start/);
    expect(params).toEqual([
      '2',
      '00000000-0000-4000-8000-0000000000aa',
      '2026-10-14',
      '09:00:00',
      '17:00:00',
      'Cashier',
      'Front counter',
      null,
    ]);
  });

  test('createShift rejects a missing user_id (the engine keys shifts on it)', async () => {
    const req = {
      params: { businessId: '2' },
      body: { shift_start: '2026-10-14T09:00', shift_end: '2026-10-14T17:00' },
    };
    const res = mockRes();
    await ctrl.createShift(req, res, next);
    expect(res.statusCode).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('createShift rejects an end before the start', async () => {
    const req = {
      params: { businessId: '2' },
      body: {
        user_id: '00000000-0000-4000-8000-0000000000aa',
        shift_start: '2026-10-14T17:00',
        shift_end: '2026-10-14T09:00',
      },
    };
    const res = mockRes();
    await ctrl.createShift(req, res, next);
    expect(res.statusCode).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('createShift rejects a non-member of the business', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // membership check: no row
    const req = {
      params: { businessId: '2' },
      body: {
        user_id: '00000000-0000-4000-8000-0000000000aa',
        shift_start: '2026-10-14T09:00',
        shift_end: '2026-10-14T17:00',
      },
    };
    const res = mockRes();
    await ctrl.createShift(req, res, next);
    expect(res.statusCode).toBe(400);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('createShift represents an overnight shift the engine understands', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 8 }] });
    const req = {
      params: { businessId: '2' },
      body: {
        user_id: '00000000-0000-4000-8000-0000000000aa',
        shift_start: '2026-10-14T22:00',
        shift_end: '2026-10-15T06:00',
      },
    };
    const res = mockRes();
    await ctrl.createShift(req, res, next);
    expect(res.statusCode).toBe(201);
    const [, params] = mockQuery.mock.calls[1];
    // Same shape the engine's overnight-shift branch (+1 day on end<=start) reads.
    expect(params.slice(2, 5)).toEqual(['2026-10-14', '22:00:00', '06:00:00']);
  });

  test('listShifts filters on shift_date and derives client datetimes', async () => {
    const row = {
      id: 7,
      shift_date: '2026-10-14',
      start_time: '09:00:00',
      end_time: '17:00:00',
      role_label: 'Cashier',
      shift_start: '2026-10-14T09:00:00',
      shift_end: '2026-10-14T17:00:00',
      role: 'Cashier',
      user_name: 'Sam Staff',
    };
    mockQuery.mockResolvedValueOnce({ rows: [row] });
    // S-04: listShifts checks isBusinessManager; provide businessRole to
    // bypass the DB lookup (mockQuery is stubbed for the shift query only).
    const req = { params: { businessId: '2' }, query: { from: '2026-10-14', to: '2026-10-15' },
      user: { id: 'test-user' }, businessRole: 'manager' };
    const res = mockRes();
    await ctrl.listShifts(req, res, next);

    expect(res.statusCode).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('shift_date >=');
    expect(sql).toContain('shift_date <=');
    // The legacy column is never read; shift_start only exists as a derived
    // alias for the existing client.
    expect(sql).not.toMatch(/WHERE[\s\S]*shift_start/);
    expect(sql).toMatch(/AS shift_start/);
    expect(params).toEqual(['2', '2026-10-14', '2026-10-15']);
    expect(res.body).toEqual([row]);
  });

  test('updateShift converts datetimes and never touches a status column', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ shift_date: '2026-10-14', start_time: '09:00:00', end_time: '17:00:00' }] })
      .mockResolvedValueOnce({ rows: [{ id: 7 }] });
    const req = {
      params: { businessId: '2', shiftId: '7' },
      body: { shift_start: '2026-10-14T10:00', shift_end: '2026-10-14T18:00', role: 'Lead' },
    };
    const res = mockRes();
    await ctrl.updateShift(req, res, next);

    expect(res.statusCode).toBe(200);
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toMatch(/UPDATE business_staff_shifts/);
    expect(sql).toContain('shift_date');
    expect(sql).not.toMatch(/shift_start/);
    expect(sql).not.toMatch(/status/);
    expect(params.slice(0, 4)).toEqual(['2026-10-14', '10:00:00', '18:00:00', 'Lead']);
  });
});

describe('businessStaffScheduleController shift updates (node-pg types)', () => {
  test('updateShift handles node-pg Date objects for shift_date', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ shift_date: new Date(Date.UTC(2026, 9, 14)), start_time: '09:00:00', end_time: '17:00:00' }] })
      .mockResolvedValueOnce({ rows: [{ id: 7 }] });
    const req = {
      params: { businessId: '2', shiftId: '7' },
      body: { shift_end: '2026-10-14T18:00' }, // start keeps the current value
    };
    const res = mockRes();
    await ctrl.updateShift(req, res, next);

    expect(res.statusCode).toBe(200);
    const [, params] = mockQuery.mock.calls[1];
    expect(params.slice(0, 3)).toEqual(['2026-10-14', '09:00:00', '18:00:00']);
  });
});

describe('businessStaffScheduleController availability and shift swaps', () => {
  test('replaceAvailability atomically replaces a member’s weekly windows', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // membership check
      .mockResolvedValueOnce({ rows: [] }) // delete
      .mockResolvedValueOnce({ rows: [] }) // insert Monday
      .mockResolvedValueOnce({ rows: [{ id: 11, day_of_week: 1, start_time: '09:00:00', end_time: '17:00:00' }] });
    const req = {
      params: { businessId: '2' },
      user: { id: '00000000-0000-4000-8000-0000000000aa' },
      body: { windows: [{ day_of_week: 1, start_time: '09:00', end_time: '17:00', notes: 'Front counter' }] },
    };
    const res = mockRes();
    await ctrl.replaceAvailability(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(res.body.windows).toHaveLength(1);
    expect(mockQuery.mock.calls[2][1]).toEqual(['2', req.user.id, 1, '09:00:00', '17:00:00', 'Front counter']);
  });

  test('replaceAvailability rejects duplicate or overnight windows before touching the database', async () => {
    const req = {
      params: { businessId: '2' },
      user: { id: '00000000-0000-4000-8000-0000000000aa' },
      body: { windows: [
        { day_of_week: 1, start_time: '22:00', end_time: '02:00' },
      ] },
    };
    const res = mockRes();
    await ctrl.replaceAvailability(req, res, next);
    expect(res.statusCode).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('staff can request a swap for their own shift and nominate a member', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 7, user_id: '00000000-0000-4000-8000-0000000000aa' }] })
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // target membership
      .mockResolvedValueOnce({ rows: [{ id: 19, status: 'requested' }] });
    const req = {
      params: { businessId: '2', shiftId: '7' },
      user: { id: '00000000-0000-4000-8000-0000000000aa' },
      businessRole: 'employee',
      body: { target_user_id: '00000000-0000-4000-8000-0000000000bb', note: 'Need coverage' },
    };
    const res = mockRes();
    await ctrl.createShiftSwapRequest(req, res, next);
    expect(res.statusCode).toBe(201);
    expect(res.body.request.status).toBe('requested');
    expect(mockQuery.mock.calls[2][0]).toMatch(/INSERT INTO business_shift_swap_requests/);
  });

  test('manager approval atomically reassigns the shift and closes the request', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 19, shift_id: 7, status: 'requested', target_user_id: '00000000-0000-4000-8000-0000000000bb', assigned_user_id: '00000000-0000-4000-8000-0000000000aa' }] })
      .mockResolvedValueOnce({ rows: [] }) // shift reassignment
      .mockResolvedValueOnce({ rows: [{ id: 19, status: 'approved' }] });
    const req = {
      params: { businessId: '2', requestId: '19' },
      user: { id: '00000000-0000-4000-8000-0000000000cc' },
      businessRole: 'manager',
    };
    const res = mockRes();
    await ctrl.approveShiftSwapRequest(req, res, next);
    expect(res.statusCode).toBe(200);
    expect(res.body.request.status).toBe('approved');
    expect(mockQuery.mock.calls[1][0]).toMatch(/UPDATE business_staff_shifts SET user_id/);
  });
});
