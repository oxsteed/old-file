'use strict';

const http = require('http');
const runtimeState = require('../services/runtimeState');
const { expectedMigrationFiles } = require('../services/readinessService');
const { ApplicationRuntime } = require('../bootstrap/applicationRuntime');

describe('ApplicationRuntime lifecycle', () => {
  beforeEach(() => runtimeState.reset());

  test('keeps realtime and the pool open until delivery worker drain completes', async () => {
    let drain;
    const workers = { stop: jest.fn(() => new Promise((resolve) => { drain = resolve; })) };
    const realtime = { close: jest.fn(async () => undefined) };
    const pool = { end: jest.fn(async () => undefined) };
    const runtime = new ApplicationRuntime({ httpServer: http.createServer(), realtime, pool, workers });
    const stopping = runtime.shutdown('test');
    await Promise.resolve();
    expect(realtime.close).not.toHaveBeenCalled();
    expect(pool.end).not.toHaveBeenCalled();
    drain();
    await stopping;
    expect(realtime.close).toHaveBeenCalledTimes(1);
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  test('starts workers only after dependency checks and drains every resource once', async () => {
    const migrations = expectedMigrationFiles();
    const pool = {
      query: jest.fn(async (sql) => sql.includes('_migrations')
        ? { rows: migrations.map((filename) => ({ filename })) }
        : { rows: [] }),
      end: jest.fn(async () => undefined),
    };
    const redis = {
      status: 'ready',
      ping: jest.fn(async () => 'PONG'),
      quit: jest.fn(async () => undefined),
    };
    const realtime = { close: jest.fn(async () => undefined) };
    const workers = {
      start: jest.fn(),
      stop: jest.fn(),
    };
    const runtime = new ApplicationRuntime({
      httpServer: http.createServer(),
      realtime,
      pool,
      redis,
      workers,
      log: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
    });
    const previousRedisUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = 'redis://configured';

    await runtime.prepare();
    runtime.markListening();
    expect(workers.start).toHaveBeenCalledTimes(1);
    expect(runtimeState.snapshot()).toMatchObject({
      acceptingTraffic: true,
      realtimeReady: true,
      workersReady: true,
      shuttingDown: false,
    });

    await Promise.all([runtime.shutdown('test'), runtime.shutdown('test')]);
    expect(workers.stop).toHaveBeenCalledTimes(1);
    expect(realtime.close).toHaveBeenCalledTimes(1);
    expect(redis.quit).toHaveBeenCalledTimes(1);
    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(runtimeState.snapshot()).toMatchObject({
      acceptingTraffic: false,
      realtimeReady: false,
      workersReady: false,
      shuttingDown: true,
    });

    if (previousRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previousRedisUrl;
  });
});
