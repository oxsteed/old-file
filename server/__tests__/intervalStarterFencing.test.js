'use strict';

// Oct 30 item 29 + audit #49 (background-jobs audit, 2026-11-08):
// the three interval starters had no running flag and no lock, and
// completeFinishedDirectVisits completed an unbounded number of Direct
// visits in one UPDATE. These tests pin the fixes: an overlapping tick
// is skipped while a slow pass is still running, each starter takes a
// distinct fenced lock, and completion works in bounded batches of 200.

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../utils/email', () => ({ sendEmail: jest.fn() }));
jest.mock('../utils/logger', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../controllers/calendarNotificationController', () => ({
  processReminderNotifications: jest.fn(),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn(async () => ({ success: true })),
}));
jest.mock('../services/franchiseRoyaltyService', () => ({
  accrueTerritoryRoyalty: jest.fn(),
}));
jest.mock('../jobs/jobLockingService', () => ({
  // Pass-through lock: the handler runs immediately, so these tests
  // exercise the starters' own running-flag logic (the real lock's
  // skip-on-contention is covered by jobLockingService's own tests).
  withFencedJobLock: jest.fn((jobName, handler) => handler()),
}));

const db = require('../db');
const calendarNotificationController = require('../controllers/calendarNotificationController');
const { accrueTerritoryRoyalty } = require('../services/franchiseRoyaltyService');
const { withFencedJobLock } = require('../jobs/jobLockingService');
const { startCalendarReminderJob } = require('../jobs/calendarReminders');
const {
  completeFinishedDirectVisits,
  startDirectCalendarReminderJob,
  COMPLETED_VISITS_BATCH_LIMIT,
} = require('../jobs/directCalendarReminders');
const { startBusinessAppointmentNoShowSweeper } = require('../jobs/businessAppointmentNoShowSweeper');

const flush = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  withFencedJobLock.mockImplementation((jobName, handler) => handler());
  accrueTerritoryRoyalty.mockResolvedValue(undefined);
  calendarNotificationController.processReminderNotifications.mockResolvedValue(undefined);
  db.query.mockResolvedValue({ rows: [] });
});

describe('item 29: overlapping ticks are skipped', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  test('calendar reminders: a slow pass skips the next tick, then runs again once clear', async () => {
    const gate = deferred();
    calendarNotificationController.processReminderNotifications.mockReturnValueOnce(gate.promise);
    const handle = startCalendarReminderJob();
    try {
      jest.advanceTimersByTime(5 * 60 * 1000);
      await flush();
      expect(calendarNotificationController.processReminderNotifications).toHaveBeenCalledTimes(1);
      expect(withFencedJobLock).toHaveBeenCalledWith('calendar-reminders', expect.any(Function), 300);

      // Second tick while the first pass is still running: skipped.
      jest.advanceTimersByTime(5 * 60 * 1000);
      await flush();
      expect(calendarNotificationController.processReminderNotifications).toHaveBeenCalledTimes(1);
      expect(withFencedJobLock).toHaveBeenCalledTimes(1);

      gate.resolve(undefined);
      await flush();

      // Flag cleared: the next tick runs again.
      jest.advanceTimersByTime(5 * 60 * 1000);
      await flush();
      expect(calendarNotificationController.processReminderNotifications).toHaveBeenCalledTimes(2);
      expect(withFencedJobLock).toHaveBeenCalledTimes(2);
    } finally {
      handle.stop();
    }
  });

  test('direct calendar reminders: a slow pass skips the next tick under one lock for both sweeps', async () => {
    const gate = deferred();
    // First db call is the reminders select; hold it open so the pass
    // is still running when the next tick fires.
    db.query.mockImplementationOnce(() => gate.promise);
    const handle = startDirectCalendarReminderJob();
    try {
      jest.advanceTimersByTime(5 * 60 * 1000);
      await flush();
      expect(db.query).toHaveBeenCalledTimes(1);
      expect(withFencedJobLock).toHaveBeenCalledWith('direct-calendar-reminders', expect.any(Function), 300);

      jest.advanceTimersByTime(5 * 60 * 1000);
      await flush();
      expect(db.query).toHaveBeenCalledTimes(1);
      expect(withFencedJobLock).toHaveBeenCalledTimes(1);

      gate.resolve({ rows: [] });
      await flush();
      // First pass finished (reminders select + completing UPDATE).
      expect(db.query).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(5 * 60 * 1000);
      await flush();
      expect(db.query).toHaveBeenCalledTimes(4);
      expect(withFencedJobLock).toHaveBeenCalledTimes(2);
    } finally {
      handle.stop();
    }
  });

  test('no-show sweeper: a slow pass skips the next tick', async () => {
    const gate = deferred();
    db.query.mockImplementationOnce(() => gate.promise);
    const handle = startBusinessAppointmentNoShowSweeper();
    try {
      jest.advanceTimersByTime(15 * 60 * 1000);
      await flush();
      expect(db.query).toHaveBeenCalledTimes(1);
      expect(withFencedJobLock).toHaveBeenCalledWith('business-appointment-no-show-sweeper', expect.any(Function), 900);

      jest.advanceTimersByTime(15 * 60 * 1000);
      await flush();
      expect(db.query).toHaveBeenCalledTimes(1);
      expect(withFencedJobLock).toHaveBeenCalledTimes(1);

      gate.resolve({ rows: [] });
      await flush();
      // First pass finished: phase 1 select (call 1) + phase 2 + phase 3 selects.
      expect(db.query).toHaveBeenCalledTimes(3);

      jest.advanceTimersByTime(15 * 60 * 1000);
      await flush();
      expect(db.query).toHaveBeenCalledTimes(6);
      expect(withFencedJobLock).toHaveBeenCalledTimes(2);
    } finally {
      handle.stop();
    }
  });

  test('each starter takes a distinct lock name', async () => {
    const handles = [
      startCalendarReminderJob(),
      startDirectCalendarReminderJob(),
      startBusinessAppointmentNoShowSweeper(),
    ];
    try {
      jest.advanceTimersByTime(15 * 60 * 1000);
      await flush();
      const names = withFencedJobLock.mock.calls.map(([name]) => name);
      expect(new Set(names).size).toBe(names.length);
      expect(names).toEqual(expect.arrayContaining([
        'calendar-reminders',
        'direct-calendar-reminders',
        'business-appointment-no-show-sweeper',
      ]));
    } finally {
      handles.forEach((handle) => handle.stop());
    }
  });
});

describe('#49: completeFinishedDirectVisits completes in bounded batches', () => {
  function mockBatches(batchSizes) {
    let updateCalls = 0;
    db.query.mockImplementation(async (sql, params) => {
      if (sql.includes('UPDATE quote_requests')) {
        const size = batchSizes[updateCalls] ?? 0;
        updateCalls += 1;
        const startId = batchSizes.slice(0, updateCalls - 1).reduce((a, b) => a + b, 0) + 1;
        return {
          rows: Array.from({ length: size }, (_, i) => ({ quote_request_id: startId + i })),
        };
      }
      if (sql.includes('FROM quote_requests')) {
        return {
          rows: (params[0] || []).map((id) => ({
            id,
            quote_amount_cents: 1000,
            service_city: 'Dayton',
          })),
        };
      }
      return { rows: [] };
    });
    return () => updateCalls;
  }

  test('a 203-visit backlog completes 200 then 3, accruing royalties per visit', async () => {
    expect(COMPLETED_VISITS_BATCH_LIMIT).toBe(200);
    const updateCalls = mockBatches([200, 3]);

    const total = await completeFinishedDirectVisits();

    expect(total).toBe(203);
    expect(updateCalls()).toBe(2);
    expect(accrueTerritoryRoyalty).toHaveBeenCalledTimes(203);
    const completingSql = db.query.mock.calls
      .map(([sql]) => sql)
      .find((sql) => sql.includes('UPDATE quote_requests'));
    expect(completingSql).toContain('LIMIT 200');
    expect(completingSql).toContain('ORDER BY COALESCE(scheduled_end_at, scheduled_start_at)');
    // No batch ever completed more than 200 visits at once.
    const batchSizes = db.query.mock.calls
      .filter(([sql]) => sql.includes('SELECT id, quote_amount_cents'))
      .map(([, params]) => params[0].length);
    expect(batchSizes).toEqual([200, 3]);
  });

  test('a short batch completes once and stops', async () => {
    const updateCalls = mockBatches([5]);

    const total = await completeFinishedDirectVisits();

    expect(total).toBe(5);
    expect(updateCalls()).toBe(1);
    expect(accrueTerritoryRoyalty).toHaveBeenCalledTimes(5);
  });

  test('no due visits completes nothing and accrues nothing', async () => {
    const updateCalls = mockBatches([0]);

    const total = await completeFinishedDirectVisits();

    expect(total).toBe(0);
    expect(updateCalls()).toBe(1);
    expect(accrueTerritoryRoyalty).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalledWith(
      expect.stringContaining('SELECT id, quote_amount_cents'),
      expect.anything()
    );
  });
});
