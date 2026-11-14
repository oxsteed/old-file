'use strict';

// Domain 8 #24: the system-closed punch notice has no idempotency key
// and no retry, while the sibling missing-punch notice carries
// `missing-punch:<shift>:<date>:<manager>`. The close commits before
// the notify, so a crash between commit and notify loses the alert
// permanently. These tests pin the key
// `system-closed:<entryId>:<managerId>` on every manager notice, so a
// retried closeout cannot double-notify and a crashed-then-retried run
// still delivers the alert once.
//
// The closeout is driven through closeStalePunches with a fake db
// handle (no real database): one stale open entry, two managers, no
// missing punches.

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
}));

const { sendNotification } = require('../services/notificationService');
const { closeStalePunches, notifyCloseoutFailure } = require('../services/restaurantPunchCloseout');

const NOW = new Date('2026-11-13T12:00:00Z');

function makeEntry() {
  return {
    id: 101,
    business_id: 7,
    user_id: 'emp-1',
    clock_in_at: new Date(NOW.getTime() - 13 * 3600 * 1000),
    entry_date: '2026-11-12',
    employee_name: 'Eli',
    business_name: 'Bistro',
    containing_close_at: null,
    fallback_close_at: null,
  };
}

function makeFakeDb(entry, managerIds) {
  const currentRow = {
    ...entry,
    clock_out_at: null,
    voided_at: null,
    hours_worked: null,
    breaks: null,
  };
  const client = {
    query: jest.fn(async (sql, params) => {
      const s = String(sql);
      if (/BEGIN|COMMIT|ROLLBACK/.test(s)) return { rows: [] };
      if (s.includes('FOR UPDATE')) return { rows: [currentRow] };
      if (s.includes('UPDATE business_time_entries')) {
        return {
          rows: [{
            ...currentRow,
            clock_out_at: params[0],
            hours_worked: params[1],
            system_closed_reason: params[2],
          }],
        };
      }
      if (s.includes('INSERT INTO business_time_entry_edits')) return { rows: [] };
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  const handle = {
    query: jest.fn(async (sql) => {
      const s = String(sql);
      // The missing-punch select mentions business_time_entries inside
      // its NOT EXISTS subquery, so it must be routed before the
      // open-entries select below.
      if (s.includes('NOT EXISTS')) return { rows: [] };
      if (s.includes('FROM business_time_entries te')) return { rows: [entry] };
      if (s.includes('FROM businesses WHERE id')) {
        return { rows: managerIds.map((user_id) => ({ user_id })) };
      }
      if (s.includes('FROM business_staff_shifts sh')) return { rows: [] };
      return { rows: [] };
    }),
    connect: jest.fn(async () => client),
  };
  return handle;
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('system-closed notice carries system-closed:<entryId>:<managerId> per manager', async () => {
  const entry = makeEntry();
  const db = makeFakeDb(entry, ['mgr-1', 'mgr-2']);
  const result = await closeStalePunches({ db, now: NOW, notify: true });

  expect(result.errors).toEqual([]);
  expect(result.closed).toHaveLength(1);
  expect(result.closed[0].entryId).toBe(101);
  expect(result.notified).toBe(2);

  const calls = sendNotification.mock.calls.map(([args]) => args);
  expect(calls).toHaveLength(2);
  expect(calls.map((c) => c.type)).toEqual([
    'staff_time_entry_system_closed',
    'staff_time_entry_system_closed',
  ]);
  expect(calls.map((c) => c.idempotencyKey).sort()).toEqual([
    'system-closed:101:mgr-1',
    'system-closed:101:mgr-2',
  ]);
});

// Domain 8 #25: the closeout-failure alert has no dedupe key, so every
// failed hourly run re-alerts every manager of every business with
// stale punches. The key is per business per day: one alert per
// business per day no matter how many runs fail.
describe('notifyCloseoutFailure dedupe (Domain 8 #25)', () => {
  function makeFailureFakeDb() {
    return {
      query: jest.fn(async (sql) => {
        const s = String(sql);
        if (s.includes('GROUP BY business_id')) {
          return { rows: [{ business_id: 7, stale_count: 3 }] };
        }
        if (s.includes('FROM businesses WHERE id')) {
          return { rows: [{ user_id: 'mgr-1' }] };
        }
        return { rows: [] };
      }),
    };
  }

  test('failure alert carries closeout-failed:<businessId>:<YYYY-MM-DD>', async () => {
    const db = makeFailureFakeDb();
    const result = await notifyCloseoutFailure(db, { now: NOW });

    expect(result.alerted).toBe(1);
    expect(result.businesses).toEqual([7]);
    const calls = sendNotification.mock.calls.map(([args]) => args);
    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe('staff_time_entry_closeout_failed');
    expect(calls[0].idempotencyKey).toBe('closeout-failed:7:2026-11-13');
  });

  test('a second failed run the same day reuses the same key', async () => {
    const db = makeFailureFakeDb();
    await notifyCloseoutFailure(db, { now: NOW });
    sendNotification.mockClear();
    await notifyCloseoutFailure(db, { now: new Date('2026-11-13T18:00:00Z') });

    const calls = sendNotification.mock.calls.map(([args]) => args);
    expect(calls).toHaveLength(1);
    expect(calls[0].idempotencyKey).toBe('closeout-failed:7:2026-11-13');
  });
});
