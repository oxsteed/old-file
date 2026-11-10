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

test('a staged worker does not contend for the advisory lock before activation', async () => {
  const pool = fakePool([true]);
  const promoted = Promise.withResolvers();
  let activate = false;
  const ownership = new WorkerOwnership({ pool, pollMs: 5, mayAcquire: () => activate });
  await ownership.start({ onAcquired: promoted.resolve });
  expect(ownership.mode).toBe('combined-standby');
  expect(pool.client.queries).toEqual([]);
  activate = true;
  await promoted.promise;
  const drain = Promise.withResolvers();
  const stopping = ownership.stop(() => drain.promise);
  await Promise.resolve();
  expect(pool.client.queries.some(([sql]) => sql.includes('pg_advisory_unlock'))).toBe(false);
  drain.resolve();
  await stopping;
  expect(pool.client.queries.at(-1)[0]).toMatch(/pg_advisory_unlock/);
});

test('shutdown during lock acquisition cannot start any consumers', async () => {
  const lockQuery = Promise.withResolvers();
  const acquiring = Promise.withResolvers();
  const client = {
    query: () => { acquiring.resolve(); return lockQuery.promise; },
    release: jest.fn(),
  };
  const ownership = new WorkerOwnership({ pool: { connect: async () => client } });
  const startWorkers = jest.fn();
  const starting = ownership.start({ onAcquired: startWorkers });
  await acquiring.promise;
  const stopping = ownership.stop();
  lockQuery.resolve({ rows: [{ acquired: true }] });
  await Promise.all([starting, stopping]);
  expect(startWorkers).not.toHaveBeenCalled();
  expect(client.release).toHaveBeenCalledWith(true);
});
