'use strict';

// Design-review fixes, items 14 / 28 / 52 (scheduled reports +
// punch closeout). All mocked: no real database, following the
// patterns in restaurantPhase7Compliance.test.js.
//
// Item 14: a delivery that throws mid-send is recorded 'failed'
// (never 'sent'), and a failed date is retried on the next run while
// a sent date is never re-sent.
// Item 28: the closeout closes a split-shift punch at the end of the
// shift containing the clock-in, and an overnight shift at the
// next-morning end (verified against the SQL text, since the shift
// selection lives in SQL; the JS close stamping is driven end to end
// through the fake transaction client below).
// Item 52: a published shift from the preceding business day with no
// time entry notifies the manager once per missing shift.

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn(async () => ({})),
}));
jest.mock('../utils/email', () => ({
  sendEmail: jest.fn(async () => ({})),
}));
jest.mock('../services/restaurantPayrollService', () => ({
  computeLabor: jest.fn(async () => ({
    from_date: '2026-11-05',
    to_date: '2026-11-05',
    timezone: 'UTC',
    currency: 'USD',
    currency_minor_unit_decimals: 2,
    revenues: [{ currency: 'USD', revenue_cents: 50000 }],
    revenue_cents: 50000,
    labor_cost_cents: 10000,
    labor_percent: 20,
    total_hours: 8,
    overtime_hours: 0,
    meal_break_premium_cents: 100,
    predictability_premium_cents: 0,
  })),
  computeExceptions: jest.fn(async () => ({
    from_date: '2026-11-05',
    to_date: '2026-11-05',
    timezone: 'UTC',
    employees: [],
  })),
}));
jest.mock('../controllers/restaurantReportsController', () => ({
  _computeDailyClose: jest.fn(async () => ({
    business_date: '2026-11-05',
    timezone: 'UTC',
    locations: [],
    brand_totals: [{ currency: 'USD', totals: { revenue_cents: 12345 } }],
  })),
}));

const scheduledReports = require('../services/restaurantScheduledReports');
const { closeStalePunches } = require('../services/restaurantPunchCloseout');
const { sendNotification } = require('../services/notificationService');

const USER_ID = '00000000-0000-4000-8000-000000000123';
const MANAGER_ID = '00000000-0000-4000-8000-000000000999';
const client = { query: (...args) => mockQuery(...args) };

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

function scheduleRow(overrides = {}) {
  return {
    id: 1, restaurant_id: 3, business_id: 42, timezone: 'UTC', currency_code: 'USD',
    location_id: null, report_type: 'labor', frequency: 'daily', delivery_channel: 'in_app',
    recipients: [{ user_id: USER_ID }], last_business_date: null,
    ...overrides,
  };
}

describe('Item 14: scheduled-report claim / retry', () => {
  test('a delivery that throws mid-send is recorded failed, never sent', async () => {
    const now = new Date('2026-11-06T10:00:00Z');
    mockQuery.mockResolvedValueOnce({ rows: [scheduleRow()] });
    // Claim: fresh row, status 'pending'.
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 7, status: 'pending' }] });
    sendNotification.mockRejectedValueOnce(new Error('delivery boom'));
    const result = await scheduledReports.runDueScheduledReports(client, { now });
    expect(result.due).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const sqls = mockQuery.mock.calls.map(([sql]) => String(sql));
    // The claim inserts 'pending', never 'sent'.
    expect(sqls[1]).toContain("'pending'");
    expect(sqls.join('\n')).not.toMatch(/'sent', 0/);
    // The failure is recorded with an UPDATE on the claimed row, not
    // a second INSERT (the old code's failure insert hit the same
    // ON CONFLICT DO NOTHING key and never landed).
    const failureUpdate = sqls.find((s) => s.includes("status = 'failed'"));
    expect(failureUpdate).toMatch(/UPDATE restaurant_scheduled_report_deliveries/);
    expect(sqls.filter((s) => s.includes('INSERT INTO restaurant_scheduled_report_deliveries'))).toHaveLength(1);
    // last_business_date advances only on success: the failed date
    // stays due.
    expect(sqls.join('\n')).not.toContain('last_business_date');
  });

  test('a failed date is retried on the next run while a sent date is never re-sent', async () => {
    const now = new Date('2026-11-06T10:00:00Z');
    // First run: the claim conflicts, the existing row is 'failed',
    // so it is re-claimed and the delivery succeeds.
    mockQuery.mockResolvedValueOnce({ rows: [scheduleRow()] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // claim INSERT: conflict
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 7, status: 'failed', created_at: '2026-11-06T08:00:00Z' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 7, status: 'pending' }] }); // reclaim UPDATE
    const first = await scheduledReports.runDueScheduledReports(client, { now });
    expect(first.sent).toBe(1);
    expect(first.failed).toBe(0);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const firstSqls = mockQuery.mock.calls.map(([sql]) => String(sql));
    expect(firstSqls.find((s) => s.includes('SET status = \'pending\''))).toBeTruthy();
    expect(firstSqls.join('\n')).toContain('last_business_date');

    // Second run for the same date: the claim conflicts, the
    // existing row is 'sent', so nothing is sent again.
    mockQuery.mockResolvedValueOnce({ rows: [scheduleRow()] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // claim INSERT: conflict
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 7, status: 'sent', created_at: '2026-11-06T08:00:00Z' }] });
    const second = await scheduledReports.runDueScheduledReports(client, { now });
    expect(second.due).toBe(1);
    expect(second.skipped).toBe(1);
    expect(second.sent).toBe(0);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  test('a fresh pending row is not double-sent; a stale pending row is reclaimed', async () => {
    const now = new Date('2026-11-06T10:00:00Z');
    // Fresh pending: another run owns the date.
    mockQuery.mockResolvedValueOnce({ rows: [scheduleRow()] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 7, status: 'pending', created_at: '2026-11-06T09:45:00Z' }] });
    const fresh = await scheduledReports.runDueScheduledReports(client, { now });
    expect(fresh.skipped).toBe(1);
    expect(fresh.sent).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();

    // Stale pending (claimed 2h ago): a crashed run; reclaim it.
    mockQuery.mockResolvedValueOnce({ rows: [scheduleRow()] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 7, status: 'pending', created_at: '2026-11-06T08:00:00Z' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 7, status: 'pending' }] });
    const stale = await scheduledReports.runDueScheduledReports(client, { now });
    expect(stale.sent).toBe(1);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });
});

// ── Fake DB for closeStalePunches: routes by SQL content and drives
// the per-entry transaction client, so the JS close stamping,
// grace gate and notifications run end to end.
function makeCloseoutDb({ openRows = [], missingRows = [] } = {}) {
  const queries = [];
  const clientQueries = [];
  const client = {
    query: jest.fn(async (sql, params = []) => {
      clientQueries.push({ sql: String(sql), params });
      if (/FOR UPDATE/.test(sql)) {
        const row = openRows.find((r) => Number(r.id) === Number(params[0]));
        return { rows: row ? [{ ...row }] : [] };
      }
      if (/UPDATE business_time_entries/.test(sql)) {
        return {
          rows: [{
            id: params[3], business_id: params[4],
            clock_out_at: params[0], hours_worked: params[1],
            system_closed_reason: params[2],
          }],
        };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  const db = {
    query: jest.fn(async (sql, params = []) => {
      queries.push(String(sql));
      // Both sweep queries mention both tables (subqueries), so
      // route on the missing-punch query's NOT EXISTS clause; the
      // open-entries query has none.
      if (sql.includes('NOT EXISTS')) return { rows: missingRows };
      if (sql.includes('FROM business_time_entries te')) return { rows: openRows };
      if (sql.includes('FROM businesses WHERE id')) return { rows: [{ user_id: MANAGER_ID }] };
      return { rows: [] };
    }),
    connect: jest.fn(async () => client),
  };
  return { db, client, queries, clientQueries };
}

function openEntry(overrides = {}) {
  return {
    id: 11, business_id: 42, user_id: USER_ID, location_id: null,
    entry_date: '2026-11-06', clock_in_at: '2026-11-06T09:00:00Z',
    close_at: '2026-11-06T12:00:00Z', has_shift: true,
    employee_name: 'Sam', business_name: 'Bistro', tz: 'UTC',
    ...overrides,
  };
}

describe('Item 28: closeout closes at the containing shift end', () => {
  test('the close-time subquery picks the containing shift, handles overnight, and ignores cancelled shifts', async () => {
    const { db, queries } = makeCloseoutDb();
    await closeStalePunches({ db, now: new Date('2026-11-07T10:00:00Z') });
    const openSql = queries.find((s) => s.includes('FROM business_time_entries te'));
    expect(openSql).toBeTruthy();
    // Containment: clock-in inside [shift start, shift end), not the
    // latest-ending shift of the day.
    expect(openSql).toContain('te.clock_in_at >=');
    expect(openSql).toContain('te.clock_in_at <');
    expect(openSql).not.toContain('ORDER BY sh.end_time DESC');
    expect(openSql).toContain('ORDER BY sh.start_time DESC LIMIT 1');
    // Overnight: end <= start closes the next morning.
    expect(openSql).toContain('sh.end_time <= sh.start_time');
    expect(openSql).toContain("INTERVAL '1 day'");
    // Cancelled shifts never close a punch: both subqueries.
    const cancelled = (openSql.match(/sh\.cancelled_at IS NULL/g) || []).length;
    expect(cancelled).toBe(2);
  });

  test('a split shift closes at the first shift end, not the latest end of the day', async () => {
    const { db, clientQueries } = makeCloseoutDb({
      openRows: [openEntry({ close_at: '2026-11-06T12:00:00Z' })],
    });
    const result = await closeStalePunches({ db, now: new Date('2026-11-06T13:00:00Z') });
    expect(result.closed).toHaveLength(1);
    expect(result.closed[0].close_reason).toBe('auto_close_shift_end');
    const update = clientQueries.find((q) => /UPDATE business_time_entries/.test(q.sql));
    expect(update.params[0]).toBe('2026-11-06T12:00:00.000Z');
    expect(update.params[1]).toBe(3); // 09:00 to 12:00
    expect(update.params[2]).toBe('auto_close_shift_end');
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'staff_time_entry_system_closed',
    }));
  });

  test('an overnight shift closes at the next-morning end', async () => {
    const { db, clientQueries } = makeCloseoutDb({
      openRows: [openEntry({
        clock_in_at: '2026-11-06T22:30:00Z',
        close_at: '2026-11-07T06:00:00Z',
      })],
    });
    const result = await closeStalePunches({ db, now: new Date('2026-11-07T07:00:00Z') });
    expect(result.closed).toHaveLength(1);
    expect(result.closed[0].close_reason).toBe('auto_close_shift_end');
    const update = clientQueries.find((q) => /UPDATE business_time_entries/.test(q.sql));
    expect(update.params[0]).toBe('2026-11-07T06:00:00.000Z');
    expect(update.params[1]).toBe(7.5); // 22:30 to 06:00
  });

  test('a close time at or before clock-in still falls back to the 12h cap', async () => {
    const { db, clientQueries } = makeCloseoutDb({
      openRows: [openEntry({ close_at: '2026-11-06T09:00:00Z' })],
    });
    const result = await closeStalePunches({ db, now: new Date('2026-11-06T22:00:00Z') });
    expect(result.closed).toHaveLength(1);
    expect(result.closed[0].close_reason).toBe('auto_close_12h_cap');
    const update = clientQueries.find((q) => /UPDATE business_time_entries/.test(q.sql));
    expect(update.params[0]).toBe('2026-11-06T21:00:00.000Z'); // clock-in + 12h
  });
});

describe('Item 52: missing-punch alert', () => {
  test('a yesterday published shift with no entry notifies the manager once', async () => {
    const { db, queries } = makeCloseoutDb({
      missingRows: [{
        id: 21, business_id: 42, user_id: USER_ID,
        shift_date: '2026-11-06', start_time: '08:00:00', end_time: '16:00:00',
        employee_name: 'Sam', business_name: 'Bistro',
      }],
    });
    const result = await closeStalePunches({ db, now: new Date('2026-11-07T10:00:00Z') });
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]).toMatchObject({
      shiftId: 21, shiftDate: '2026-11-06', startTime: '08:00', endTime: '16:00',
    });
    expect(result.missingNotified).toBe(1);
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'staff_time_entry_missing_punch',
    }));
    const body = sendNotification.mock.calls[0][0].body;
    expect(body).toContain('2026-11-06');
    // The window is yesterday only, per store timezone; cancelled
    // shifts are never flagged; an entry suppresses the alert.
    const missingSql = queries.find((s) => s.includes('NOT EXISTS'));
    expect(missingSql).toContain('::date - 1');
    expect(missingSql).toContain('sh.cancelled_at IS NULL');
    expect(missingSql).toContain('NOT EXISTS');
    expect(missingSql).toContain('sh.published_at IS NOT NULL');
  });

  test('no missing shift means no missing-punch notification', async () => {
    const { db } = makeCloseoutDb({ missingRows: [] });
    const result = await closeStalePunches({ db, now: new Date('2026-11-07T10:00:00Z') });
    expect(result.missing).toHaveLength(0);
    expect(result.missingNotified).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

// ── Background-jobs audit #43: the fenced sweep routes through the
// fence, never the raw pool. The fake fence's db.query delegates to
// the fake db (same routing), and fencedTransaction runs the work
// against the fake transaction client, so the close still lands end
// to end while proving the routing.
const { LeaseLostError } = require('../jobs/jobLockingService');

function makeFence({ db, client }) {
  const fence = {
    assertActive: jest.fn(),
    db: { query: jest.fn(async (...args) => db.query(...args)) },
    fencedTransaction: jest.fn(async (work) => work(client)),
  };
  return fence;
}

describe('Background-jobs audit #43: closeout routes through the fence', () => {
  test('with a fence the per-entry close uses fencedTransaction, never db.connect', async () => {
    const { db, client } = makeCloseoutDb({
      openRows: [openEntry({ close_at: '2026-11-06T12:00:00Z' })],
    });
    const fence = makeFence({ db, client });
    const result = await closeStalePunches({ db, fence, now: new Date('2026-11-06T13:00:00Z') });
    expect(result.closed).toHaveLength(1);
    expect(result.closed[0].close_reason).toBe('auto_close_shift_end');
    expect(fence.fencedTransaction).toHaveBeenCalledTimes(1);
    expect(db.connect).not.toHaveBeenCalled();
    // The sweep selects went through fence.db, not the raw pool handle.
    expect(fence.db.query).toHaveBeenCalled();
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'staff_time_entry_system_closed',
    }));
  });

  test('a lost lease refuses the sweep before any close is attempted', async () => {
    const { db, client } = makeCloseoutDb({
      openRows: [openEntry({ close_at: '2026-11-06T12:00:00Z' })],
    });
    const fence = {
      assertActive: jest.fn(),
      db: { query: jest.fn(async () => { throw new LeaseLostError('restaurant-punch-closeout'); }) },
      fencedTransaction: jest.fn(),
    };
    await expect(closeStalePunches({ db, fence, now: new Date('2026-11-06T13:00:00Z') }))
      .rejects.toThrow('lease lost');
    expect(fence.fencedTransaction).not.toHaveBeenCalled();
    expect(db.connect).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
