'use strict';

const http = require('http');
const runtimeState = require('../services/runtimeState');
const { expectedMigrationFiles } = require('../services/readinessService');
const { ApplicationRuntime } = require('../bootstrap/applicationRuntime');
jest.mock('../bootstrap/backgroundWorkers', () => ({
  BackgroundWorkers: jest.fn(() => { throw new Error('Job consumers must not be constructed in a web replacement'); }),
}));

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

describe('web-only application startup', () => {
  const originalRole = process.env.OXSTEED_RUNTIME_ROLE;
  const originalRedis = process.env.REDIS_URL;
  const originalReadiness = process.env.BACKGROUND_READINESS_URL;
  let fetchMock;
  let runtime;
  beforeEach(() => {
    runtimeState.reset();
    process.env.OXSTEED_RUNTIME_ROLE = 'web';
    process.env.REDIS_URL = 'redis://synthetic';
    process.env.BACKGROUND_READINESS_URL = 'http://app:5000/ready';
    fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({ status: 'ready', checks: { workers: { ok: true, mode: 'combined' } } }),
    });
    runtime = new ApplicationRuntime({
      httpServer: http.createServer(),
      realtime: { close: jest.fn(async () => undefined) },
      pool: {
        query: jest.fn(async sql => ({ rows: sql.includes('_migrations') ? expectedMigrationFiles().map(filename => ({ filename })) : [] })),
        end: jest.fn(async () => undefined),
      },
      redis: { ping: async () => 'PONG', quit: async () => undefined },
      log: { info: jest.fn() },
      drain: async () => undefined,
    });
  });
  afterEach(async () => {
    await runtime.shutdown('test');
    fetchMock.mockRestore();
    for (const [key, value] of Object.entries({ OXSTEED_RUNTIME_ROLE: originalRole, REDIS_URL: originalRedis, BACKGROUND_READINESS_URL: originalReadiness })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  test('observes existing workers without constructing the consumer registry', async () => {
    await runtime.prepare();
    expect(require('../bootstrap/backgroundWorkers').BackgroundWorkers).not.toHaveBeenCalled();
    expect(runtimeState.snapshot()).toMatchObject({ workersReady: true, workerMode: 'delegated', acceptingTraffic: false });
    runtime.markListening();
    expect(runtimeState.snapshot().acceptingTraffic).toBe(true);
  });
  test('refuses readiness without the background runtime', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    await expect(runtime.prepare()).rejects.toThrow('web replacement refused');
    expect(runtimeState.snapshot()).toMatchObject({ acceptingTraffic: false, workersReady: false });
  });
  test('refuses multi-process startup without shared Redis', async () => {
    delete process.env.REDIS_URL;
    await expect(runtime.prepare()).rejects.toThrow('require shared Redis');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test('does not observe workers or accept traffic before shared realtime is ready', async () => {
    let ready;
    runtime.realtime.ready = () => new Promise(resolve => { ready = resolve; });
    const preparing = runtime.prepare();
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(runtimeState.snapshot().acceptingTraffic).toBe(false);
    ready(false);
    await expect(preparing).rejects.toThrow('Realtime coordination is not ready');
    expect(runtimeState.snapshot()).toMatchObject({ acceptingTraffic: false, realtimeReady: false, workersReady: false });
  });
  test('withdraws readiness while HTTP and realtime remain available during proxy drain', async () => {
    let release;
    runtime.drain = () => new Promise(resolve => { release = resolve; });
    await runtime.prepare();
    await new Promise(resolve => runtime.httpServer.listen(0, '127.0.0.1', resolve));
    runtime.markListening();
    const shutdown = runtime.shutdown('test');
    expect(runtimeState.snapshot()).toMatchObject({ acceptingTraffic: false, shuttingDown: true, workersReady: false });
    expect(runtime.httpServer.listening).toBe(true);
    expect(runtime.realtime.close).not.toHaveBeenCalled();
    release();
    await shutdown;
    expect(runtime.httpServer.listening).toBe(false);
  });
});
