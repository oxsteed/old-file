'use strict';

const runtimeState = require('../services/runtimeState');
const { DelegatedWorkers, backgroundReadinessUrl } = require('../bootstrap/delegatedWorkers');
const { runtimeRole, runsBackgroundWorkers } = require('../utils/runtimeRole');

describe('web replacements delegate background work without starting consumers', () => {
  beforeEach(() => runtimeState.reset());

  test('combined remains the default and unknown roles are refused', () => {
    expect(runtimeRole({})).toBe('combined');
    expect(runsBackgroundWorkers({})).toBe(true);
    expect(runsBackgroundWorkers({ OXSTEED_RUNTIME_ROLE: 'web' })).toBe(false);
    expect(() => runtimeRole({ OXSTEED_RUNTIME_ROLE: 'weeb' })).toThrow();
  });

  test('only an explicit private service readiness URL is accepted', () => {
    expect(backgroundReadinessUrl('http://app:5000/ready')).toBe('http://app:5000/ready');
    for (const value of [undefined, '', 'https://app/ready', 'http://localhost/ready',
      'http://127.0.0.1/ready', 'http://external.example/ready', 'http://app/health',
      'http://user:secret@app/ready', 'http://app/ready?key=synthetic', 'http://app/ready#fragment']) {
      expect(() => backgroundReadinessUrl(value)).toThrow();
    }
  });

  test('a failed or non-worker dependency refuses web startup', async () => {
    for (const result of [null, { status: 'ready', checks: { workers: { ok: false } } },
      { status: 'ready', checks: { workers: { ok: true, mode: 'delegated' } } },
      { status: 'ready', checks: { workers: { ok: true, mode: 'unknown' } } },
      { status: 'alive', checks: { workers: { ok: true } } }]) {
      const workers = new DelegatedWorkers({ url: 'http://app:5000/ready', fetchImpl: async () => ({ ok: !!result, json: async () => result }) });
      await expect(workers.start()).rejects.toThrow('background runtime is not ready');
      expect(workers.timer).toBeNull();
      expect(runtimeState.snapshot().workersReady).toBe(false);
      await workers.stop();
    }
  });

  test('a responsive background check may take longer than 1.5 seconds without falsely withdrawing web readiness', async () => {
    const delay = require('node:timers/promises').setTimeout;
    const workers = new DelegatedWorkers({ url: 'http://app:5000/ready', fetchImpl: async (_url, { signal }) => {
      await delay(1800, undefined, { signal });
      return { ok: true, json: async () => ({ status: 'ready', checks: { workers: { ok: true, mode: 'combined' } } }) };
    } });
    try {
      await workers.start();
      expect(runtimeState.snapshot()).toMatchObject({ workersReady: true, workerMode: 'delegated' });
    } finally { await workers.stop(); }
  });

  test('shutdown during startup cannot leave an observation timer running', async () => {
    let release;
    const workers = new DelegatedWorkers({ url: 'http://app:5000/ready', fetchImpl: () => new Promise(resolve => { release = resolve; }) });
    const starting = workers.start();
    await expect(workers.start()).rejects.toThrow('already running or draining');
    const draining = workers.stop();
    release({ ok: true, json: async () => ({ status: 'ready', checks: { workers: { ok: true } } }) });
    await expect(starting).rejects.toThrow('web replacement refused');
    await draining;
    expect(workers.timer).toBeNull();
    expect(workers.started).toBe(false);
    expect(await workers.observe()).toBe(false);
    expect(runtimeState.snapshot().workersReady).toBe(false);
  });

  test('healthy legacy or combined workers are accepted, with failures reflected truthfully', async () => {
    let healthy = true;
    const fetchImpl = jest.fn(async () => {
      if (!healthy) throw new Error('Synthetic private dependency unavailable');
      return { ok: true, json: async () => ({ status: 'ready', checks: { workers: { ok: true } } }) };
    });
    const workers = new DelegatedWorkers({ url: 'http://app:5000/ready', fetchImpl });
    await workers.start();
    expect(runtimeState.snapshot()).toMatchObject({ workersReady: true, workerMode: 'delegated' });
    expect(fetchImpl.mock.calls[0][1].redirect).toBe('error');
    healthy = false;
    await workers.observe();
    expect(runtimeState.snapshot().workersReady).toBe(false);
    await workers.stop();
    expect(workers.timer).toBeNull();
  });

  test('observations coalesce and shutdown drains local handles without stopping the background runtime', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const fetchImpl = jest.fn(() => pending);
    const workers = new DelegatedWorkers({ url: 'http://app:5000/ready', fetchImpl });
    const first = workers.observe(), second = workers.observe();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const stop = jest.fn(async () => undefined);
    workers.handles.push({ stop });
    const draining = workers.stop();
    release({ ok: true, json: async () => ({ status: 'ready', checks: { workers: { ok: true } } }) });
    await Promise.all([first, second, draining]);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls.every(([, options]) => !options.method || options.method === 'GET')).toBe(true);
    expect(runtimeState.snapshot().workersReady).toBe(false);
  });
});
