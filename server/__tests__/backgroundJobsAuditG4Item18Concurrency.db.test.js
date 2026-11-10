'use strict';

// Background-jobs audit, Oct 30 item 18 (Group 4), DB half: a second
// concurrent tick of the same inline cron must NOT run the cron body.
// This drives the REAL withFencedJobLock against the disposable
// credit_statement_test database (the wiring half, with a stubbed lock,
// lives in backgroundJobsAuditG4Item18.test.js).
//
// DB: disposable credit_statement_test only, migrated first:
//   DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test
//   STATEMENT_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test
//     npx jest __tests__/backgroundJobsAuditG4Item18Concurrency.db.test.js

jest.unmock('pg');
jest.unmock('../db');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && url.pathname === '/credit_statement_test';
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';

  jest.mock('node-cron', () => {
    const scheduled = [];
    const tasksById = new Map();
    let nextId = 0;
    const schedule = jest.fn((expression, callback, options) => {
      const task = { stop: jest.fn(), destroy: jest.fn(), getStatus: jest.fn(() => 'scheduled') };
      scheduled.push({ expression, callback, options, task });
      tasksById.set(`task-${nextId}`, task);
      nextId += 1;
      return task;
    });
    return {
      schedule,
      getTasks: jest.fn(() => tasksById),
      getTask: jest.fn((id) => tasksById.get(id)),
      validate: jest.fn(() => true),
      __scheduled: scheduled,
      __tasksById: tasksById,
    };
  });

  jest.mock('../services/supportWaitService', () => ({
    processWaiting: jest.fn(),
  }));

  jest.mock('../services/localDeliveryEventWorker', () => ({
    startLocalDeliveryEventWorker: jest.fn(),
  }));

  const cron = require('node-cron');
  const pool = require('../db');
  const { processWaiting } = require('../services/supportWaitService');
  const { BackgroundWorkers } = require('../bootstrap/backgroundWorkers');

  const SUPPORT_WAITING_LOCK_ID = 'job_lock:support-waiting';

  async function waitFor(predicate, { timeoutMs = 5000, stepMs = 10 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await predicate()) return;
      if (Date.now() > deadline) throw new Error('timed out waiting for condition');
      await new Promise((resolve) => { setTimeout(resolve, stepMs); });
    }
  }

  ddescribe('Background-jobs audit, Oct 30 item 18: concurrent ticks are fenced', () => {
    let workers;

    afterEach(async () => {
      if (workers) {
        await workers.stop().catch(() => {});
        workers = null;
      }
      // Safety net: never leave a lock row behind for a re-run, even if
      // the run under test failed before its finally released the lock.
      await pool.query(
        'DELETE FROM cron_job_locks WHERE lock_id = $1',
        [SUPPORT_WAITING_LOCK_ID],
      ).catch(() => {});
    });

    afterAll(async () => {
      await pool.end().catch(() => {});
    });

    test('two concurrent support-waiting ticks run the body once; the next tick runs it again', async () => {
      let releaseFirstRun;
      const firstRunGate = new Promise((resolve) => { releaseFirstRun = resolve; });
      let calls = 0;
      processWaiting.mockImplementation(() => {
        calls += 1;
        // The first run blocks inside the body while the second tick
        // tries (and must fail) to acquire the same lock.
        if (calls === 1) return firstRunGate;
        return Promise.resolve();
      });

      const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
      workers = new BackgroundWorkers({ log });
      workers.start();

      // The fenced crons register as one contiguous run anchored at the
      // promotion-link prune expression; the support-waiting entry
      // ('*/10 * * * * *') follows it.
      const scheduled = cron.__scheduled;
      const anchor = scheduled.findIndex((entry) => entry.expression === '0 17 3 * * *');
      expect(anchor).toBeGreaterThanOrEqual(0);
      const waitingEntry = scheduled.find(
        (entry, i) => i > anchor && entry.expression === '*/10 * * * * *',
      );
      expect(waitingEntry).toBeDefined();

      // Tick 1 acquires the lock and blocks inside processWaiting.
      waitingEntry.callback();
      await waitFor(() => processWaiting.mock.calls.length === 1);

      // Tick 2 fires while tick 1 still holds the lock: it must be
      // skipped, so the body is not entered a second time.
      waitingEntry.callback();
      await new Promise((resolve) => { setTimeout(resolve, 300); });
      expect(processWaiting).toHaveBeenCalledTimes(1);

      // Let tick 1 finish and release its lock, then a later tick runs
      // the body again: the lock is per-tick exclusion, not a latch.
      releaseFirstRun();
      await waitFor(async () => {
        const { rows } = await pool.query(
          'SELECT 1 FROM cron_job_locks WHERE lock_id = $1',
          [SUPPORT_WAITING_LOCK_ID],
        );
        return rows.length === 0;
      });
      waitingEntry.callback();
      await waitFor(() => processWaiting.mock.calls.length === 2);
      expect(processWaiting).toHaveBeenCalledTimes(2);
    });
  });
}
