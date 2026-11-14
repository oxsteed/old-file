'use strict';

// Domain 1 product-surfaces audit, Nov 10 item 6 (NEW, LOW-MED):
// a standby replacement booting while the old owner still holds the
// advisory lock must not start the worker-owner extras (statement export
// polling + auxiliary workers). server/index.js called
// startWorkerOwnerExtras() unconditionally after listen(), and the
// module-level statementExportStarted / auxiliaryWorkersStarted flags
// were set true by that call, so the onOwnerAcquired hook firing later
// (when the standby finally won the lock) was a no-op. The gate was
// bypassed exactly in the case it was built for.
//
// c3aacf523 added an owner check inside startWorkerOwnerExtras() itself;
// this test pins the remaining contract at both levels:
//   (1) the post-listen call site in startServer() is conditional on
//       runtime.workers.owned (the BackgroundWorkers.owned flag, set true
//       only in startOwned()), so a standby never even reaches the call;
//   (2) the owner hook fires exactly once, and only when ownership is
//       actually acquired: not at start() time for a standby, once on
//       promotion, once during start() for an immediate owner.

const fs = require('node:fs');
const path = require('node:path');
const { BackgroundWorkers } = require('../bootstrap/backgroundWorkers');

function fakePool(acquiredValues) {
  const client = {
    queries: [],
    async query(sql, params) {
      this.queries.push([sql, params]);
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: acquiredValues.shift() }] };
      return { rows: [{ unlocked: true }] };
    },
    on: jest.fn(),
    off: jest.fn(),
    release: jest.fn(),
  };
  return { client, connect: async () => client };
}

const quietLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

describe('Domain 1 item 6: standby must not start worker-owner extras', () => {
  test('post-listen startWorkerOwnerExtras() call is gated on runtime.workers.owned', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    const markListening = source.indexOf('runtime.markListening();');
    expect(markListening).toBeGreaterThan(-1);
    const postListenCall = source.indexOf('await startWorkerOwnerExtras();', markListening);
    expect(postListenCall).toBeGreaterThan(-1);
    const callSite = source.slice(markListening, postListenCall);
    expect(callSite).toMatch(/runtime\.workers\.owned/);
  });

  test('startWorkerOwnerExtras() itself still refuses a non-owner (defense in depth)', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    const start = source.indexOf('async function startWorkerOwnerExtras()');
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf('const runtime = new ApplicationRuntime', start));
    expect(body).toMatch(/runtime\.workers\.status\(\)\.owner/);
  });

  test('standby does not fire the owner hook at start; promotion fires it exactly once', async () => {
    const pool = fakePool([false, true]);
    const onOwnerAcquired = jest.fn();
    const workers = new BackgroundWorkers({ log: quietLog, pool, onOwnerAcquired });
    try {
      // BackgroundWorkers.start() resolves to the workers instance, not the
      // mode; the mode lives on status()/ownership.
      await workers.start();
      expect(workers.status().mode).toBe('combined-standby');
      expect(workers.owned).toBe(false);
      expect(workers.status().owner).toBe(false);
      // Listen time for a standby: nothing owner-gated has started.
      expect(onOwnerAcquired).not.toHaveBeenCalled();

      // The old owner releases the lock; this process wins it.
      await workers.ownership.acquire();
      expect(workers.owned).toBe(true);
      expect(workers.status().owner).toBe(true);
      expect(onOwnerAcquired).toHaveBeenCalledTimes(1);
    } finally {
      await workers.stop();
    }
  });

  test('immediate owner fires the hook exactly once during start (normal single-owner boot)', async () => {
    const pool = fakePool([true]);
    const onOwnerAcquired = jest.fn();
    const workers = new BackgroundWorkers({ log: quietLog, pool, onOwnerAcquired });
    try {
      await workers.start();
      expect(workers.status().mode).toBe('combined');
      expect(workers.owned).toBe(true);
      expect(onOwnerAcquired).toHaveBeenCalledTimes(1);
    } finally {
      await workers.stop();
    }
  });
});
