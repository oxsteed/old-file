'use strict';

const { WorkerOwnership, LOCK_KEY } = require('../bootstrap/workerOwnership');

function fakePool(acquiredValues) {
  const client = {
    queries: [],
    async query(sql, params) {
      this.queries.push([sql, params]);
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: acquiredValues.shift() }] };
      return { rows: [{ unlocked: true }] };
    },
    release: () => { client.released = (client.released || 0) + 1; },
  };
  return { client, connect: async () => client };
}

test('holds one advisory session for the owner and releases it on stop', async () => {
  const pool = fakePool([true]);
  let acquired = 0;
  const ownership = new WorkerOwnership({ pool, onAcquired: () => { acquired += 1; } });
  await ownership.start({ onAcquired: () => { acquired += 1; } });
  expect(ownership.mode).toBe('combined');
  expect(acquired).toBe(1);
  await ownership.stop();
  expect(pool.client.queries[0][0]).toMatch(/pg_try_advisory_lock/);
  expect(pool.client.queries[0][1]).toEqual([LOCK_KEY]);
  expect(pool.client.queries.at(-1)[0]).toMatch(/pg_advisory_unlock/);
  expect(pool.client.released).toBe(1);
});

test('starts as standby and promotes after the current owner releases the lock', async () => {
  const pool = fakePool([false, true]);
  let promoted = 0;
  const ownership = new WorkerOwnership({ pool, pollMs: 5 });
  await ownership.start({ onAcquired: () => { promoted += 1; } });
  expect(ownership.mode).toBe('combined-standby');
  await new Promise(resolve => setTimeout(resolve, 15));
  expect(ownership.mode).toBe('combined');
  expect(promoted).toBe(1);
  await ownership.stop();
});
