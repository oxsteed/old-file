'use strict';

// Phase 4 Track B (goal goal_a0fc7c0f0394): copy-week and shift
// templates. Drafts are created, conflicting shifts are skipped with
// reasons, and no conflicting draft is ever created. One bad shift
// never fails the whole copy.

const { mockQuery, resetMocks } = require('./setup');
jest.mock('../services/restaurantWorkforceScope', () => ({
  ...jest.requireActual('../services/restaurantWorkforceScope'),
  context: jest.fn(async () => null),
}));
const ctrl = require('../controllers/businessStaffScheduleController');

const STAFF = '00000000-0000-4000-8000-0000000000aa';
const TARGET = '00000000-0000-4000-8000-0000000000bb';
const MANAGER = '00000000-0000-4000-8000-0000000000cc';

// Source week: Monday 2026-11-02. Target week: Monday 2026-11-09.
const SOURCE_MON = '2026-11-02';
const TARGET_MON = '2026-11-09';

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

function managerReq(body, params = {}) {
  return {
    params: { businessId: '2', ...params },
    body,
    user: { id: MANAGER },
    businessRole: 'manager',
  };
}

describe('copyWeek', () => {
  test('creates drafts for clean shifts and skips the conflicting one with its reason', async () => {
    const sourceShifts = [
      { id: 11, user_id: STAFF, shift_date: '2026-11-02', start_time: '09:00:00', end_time: '17:00:00', role_label: 'Cashier', notes: null, location_id: null, restaurant_id: null },
      { id: 12, user_id: TARGET, shift_date: '2026-11-03', start_time: '09:00:00', end_time: '17:00:00', role_label: 'Cook', notes: null, location_id: null, restaurant_id: null },
    ];
    // STAFF already has a shift in the target week on Monday 09:00-17:00.
    const targetConflict = [
      { id: 21, shift_date: '2026-11-09', start_time: '09:00:00', end_time: '17:00:00' },
    ];
    mockQuery.mockImplementation(async (sql, params) => {
      const s = String(sql);
      // The source-week read is the only business_staff_shifts query
      // carrying published_at IS NOT NULL.
      if (s.includes('FROM business_staff_shifts') && s.includes('published_at IS NOT NULL')) {
        return { rows: sourceShifts };
      }
      // Track A validateShift: other shifts for the candidate.
      if (s.includes('FROM business_staff_shifts')) {
        return { rows: params[1] === STAFF ? targetConflict : [] };
      }
      if (s.includes('FROM business_time_off_requests')) return { rows: [] };
      if (s.includes('FROM business_staff_availability')) return { rows: [] };
      if (s.includes('FROM business_staff_labor_profiles')) return { rows: [] };
      if (s.includes('INSERT INTO business_staff_shifts')) {
        return { rows: [{ id: 99, user_id: params[1], shift_date: params[2], published_at: null }] };
      }
      return { rows: [] };
    });
    const req = managerReq({ source_week_start: SOURCE_MON, target_week_start: TARGET_MON });
    const res = mockRes();
    await ctrl.copyWeek(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.created).toHaveLength(1);
    expect(res.body.created[0].user_id).toBe(TARGET);
    expect(res.body.created[0].published_at).toBeNull();
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0].user_id).toBe(STAFF);
    expect(res.body.skipped[0].reason).toBe('conflict');
    expect(res.body.skipped[0].violations.map((v) => v.code)).toContain('shift_overlap');
    // Exactly one insert ran: no conflicting draft was created.
    const inserts = mockQuery.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO business_staff_shifts'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1][2]).toBe('2026-11-10');
  });

  test('both week starts must be Mondays', async () => {
    const req = managerReq({ source_week_start: '2026-11-03', target_week_start: TARGET_MON });
    const res = mockRes();
    await ctrl.copyWeek(req, res, next);
    expect(res.statusCode).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('non-managers cannot copy a week', async () => {
    const req = {
      params: { businessId: '2' },
      body: { source_week_start: SOURCE_MON, target_week_start: TARGET_MON },
      user: { id: STAFF },
      businessRole: 'member',
    };
    const res = mockRes();
    await ctrl.copyWeek(req, res, next);
    expect(res.statusCode).toBe(403);
  });
});

describe('shift templates', () => {
  test('applyShiftTemplate reuses the copy path: clean rows become drafts, conflicts are skipped', async () => {
    const templateShifts = [
      { id: 31, template_id: 7, user_id: STAFF, day_of_week: 1, start_time: '09:00:00', end_time: '17:00:00', role_label: 'Cashier', notes: null, location_id: null, restaurant_id: null },
      { id: 32, template_id: 7, user_id: TARGET, day_of_week: 2, start_time: '09:00:00', end_time: '17:00:00', role_label: 'Cook', notes: null, location_id: null, restaurant_id: null },
    ];
    mockQuery.mockImplementation(async (sql, params) => {
      const s = String(sql);
      if (s.includes('FROM business_shift_templates')) {
        return { rows: [{ id: 7, business_id: 2, name: 'Standard week' }] };
      }
      if (s.includes('FROM business_shift_template_shifts')) return { rows: templateShifts };
      if (s.includes('FROM business_staff_shifts')) {
        // STAFF has approved time off on the template's Monday: the
        // Monday candidate is skipped, the Tuesday one is created.
        return { rows: [] };
      }
      if (s.includes('FROM business_time_off_requests')) {
        return { rows: params[1] === STAFF
          ? [{ id: 5, request_type: 'vacation', start_date: '2026-11-09', end_date: '2026-11-09' }]
          : [] };
      }
      if (s.includes('FROM business_staff_availability')) return { rows: [] };
      if (s.includes('FROM business_staff_labor_profiles')) return { rows: [] };
      if (s.includes('INSERT INTO business_staff_shifts')) {
        return { rows: [{ id: 100, user_id: params[1], shift_date: params[2], published_at: null }] };
      }
      return { rows: [] };
    });
    const req = managerReq({ target_week_start: TARGET_MON }, { templateId: '7' });
    const res = mockRes();
    await ctrl.applyShiftTemplate(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.template_name).toBe('Standard week');
    expect(res.body.created).toHaveLength(1);
    expect(res.body.created[0].user_id).toBe(TARGET);
    expect(res.body.created[0].shift_date).toBe('2026-11-10');
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0].user_id).toBe(STAFF);
    expect(res.body.skipped[0].violations.map((v) => v.code)).toContain('time_off_overlap');
  });

  test('applyShiftTemplate 404s on an unknown template', async () => {
    mockQuery.mockImplementation(async () => ({ rows: [] }));
    const req = managerReq({ target_week_start: TARGET_MON }, { templateId: '999' });
    const res = mockRes();
    await ctrl.applyShiftTemplate(req, res, next);
    expect(res.statusCode).toBe(404);
  });

  test('saveShiftTemplate refuses a week with no published shifts', async () => {
    mockQuery.mockImplementation(async () => ({ rows: [] }));
    const req = managerReq({ name: 'Empty week', week_start: SOURCE_MON });
    const res = mockRes();
    await ctrl.saveShiftTemplate(req, res, next);
    expect(res.statusCode).toBe(400);
  });
});
