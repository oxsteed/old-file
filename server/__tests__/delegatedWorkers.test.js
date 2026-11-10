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

  test('either private endpoint can prove worker readiness during a handoff', async () => {
    const primary = 'http://worker-a:5000/ready';
    const alternate = 'http://worker-b:5000/ready';
    let active = primary;
    const fetchImpl = jest.fn(async url => ({
      ok: true,
      json: async () => ({
        status: 'ready',
        checks: { workers: { ok: true, mode: url === active ? 'combined' : 'delegated' } },
      }),
    }));
    const workers = new DelegatedWorkers({ url: primary, fallbackUrl: alternate, fetchImpl });
    try {
      await workers.start();
      active = alternate;
      await expect(workers.observe()).resolves.toBe(true);
      expect(runtimeState.snapshot().workersReady).toBe(true);
      active = null;
      await expect(workers.observe()).resolves.toBe(false);
      expect(runtimeState.snapshot().workersReady).toBe(false);
    } finally { await workers.stop(); }
  });

  test('a serving web replica waits within the probe budget for a healthy standby to acquire ownership', async () => {
    const primary = 'http://worker-a:5000/ready';
    const alternate = 'http://worker-b:5000/ready';
    let incumbentReady = true;
    let probes = 0;
    const workers = new DelegatedWorkers({
      url: primary,
      fallbackUrl: alternate,
      timeoutMs: 500,
      fetchImpl: async url => ({
        ok: url !== primary || incumbentReady,
        json: async () => ({ status: 'ready', checks: { workers: {
          ok: true, mode: url === primary || ++probes > 1 ? 'combined' : 'combined-standby',
        } } }),
      }),
    });
    try {
      await workers.start();
      runtimeState.update({ acceptingTraffic: true });
      incumbentReady = false;
      probes = 0;
      await expect(workers.observe()).resolves.toBe(true);
      expect(probes).toBe(2);
      expect(runtimeState.snapshot().workersReady).toBe(true);
    } finally { await workers.stop(); }
  });

  test('rechecks the incumbent if the staged worker disappears during rollback', async () => {
    const primary = 'http://worker-a:5000/ready';
    const alternate = 'http://worker-b:5000/ready';
    let rollback = false;
    let incumbentProbes = 0;
    let standbyProbes = 0;
    const workers = new DelegatedWorkers({
      url: primary,
      fallbackUrl: alternate,
      timeoutMs: 900,
      fetchImpl: async url => ({
        ok: !rollback || (url === primary ? ++incumbentProbes >= 3 : ++standbyProbes === 1),
        json: async () => ({ status: 'ready', checks: { workers: {
          ok: true, mode: url === primary ? 'combined' : 'combined-standby',
        } } }),
      }),
    });
    try {
      await workers.start();
      runtimeState.update({ acceptingTraffic: true });
      rollback = true;
      await expect(workers.observe()).resolves.toBe(true);
      expect(incumbentProbes).toBe(3);
      expect(standbyProbes).toBe(3);
    } finally { await workers.stop(); }
  });

  test('a healthy worker cancels the other observation without waiting for its deadline', async () => {
    const primary = 'http://worker-a:5000/ready';
    const alternate = 'http://worker-b:5000/ready';
    let pendingSignal;
    const workers = new DelegatedWorkers({
      url: primary,
      fallbackUrl: alternate,
      fetchImpl: async (url, { signal }) => {
        if (url === primary) {
          pendingSignal = signal;
          await require('node:timers/promises').setTimeout(10000, undefined, { signal });
        }
        return { ok: true, json: async () => ({ status: 'ready', checks: { workers: { ok: true, mode: 'combined' } } }) };
      },
    });
    try {
      await workers.start();
      expect(pendingSignal.aborted).toBe(true);
      expect(pendingSignal.reason.name).toBe('AbortError');
    } finally { await workers.stop(); }
  });

  test('the alternate endpoint must be private and distinct', () => {
    const url = 'http://worker-a:5000/ready';
    expect(() => new DelegatedWorkers({ url, fallbackUrl: url })).toThrow('must be distinct');
    expect(() => new DelegatedWorkers({ url, fallbackUrl: 'http://external.example/ready' }))
      .toThrow('BACKGROUND_READINESS_FALLBACK_URL');
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

  describe('timeout confirmation for serving replicas', () => {
    const ready = () => ({
      ok: true,
      json: async () => ({ status: 'ready', checks: { workers: { ok: true, mode: 'combined' } } }),
    });
    const missDeadline = async (_url, { signal }) => {
      await require('node:timers/promises').setTimeout(1000, undefined, { signal });
    };

    test('keeps the serving replica ready when a single timeout is followed by a successful probe', async () => {
      const fetchImpl = jest.fn()
        .mockImplementationOnce(ready)
        .mockImplementationOnce(missDeadline)
        .mockImplementationOnce(() => {
          expect(runtimeState.snapshot().workersReady).toBe(true);
          return ready();
        });
      const workers = new DelegatedWorkers({ url: 'http://app:5000/ready', timeoutMs: 20, fetchImpl });
      try {
        await workers.start();
        runtimeState.update({ acceptingTraffic: true });
        await expect(workers.observe()).resolves.toBe(true);
        expect(fetchImpl).toHaveBeenCalledTimes(3);
        expect(runtimeState.snapshot().workersReady).toBe(true);
      } finally { await workers.stop(); }
    });

    test('a recovering worker gets the normal probe budget for confirmation', async () => {
      const delay = require('node:timers/promises').setTimeout;
      const fetchImpl = jest.fn()
        .mockImplementationOnce(ready)
        .mockImplementationOnce(async (_url, { signal }) => {
          await delay(3000, undefined, { signal });
          return ready();
        })
        .mockImplementationOnce(async (_url, { signal }) => {
          // Slower than the old 1.5s confirmation but within the 2s probe
          // budget. Serving traffic must remain available until it replies.
          expect(runtimeState.snapshot().workersReady).toBe(true);
          await delay(1700, undefined, { signal });
          return ready();
        });
      const workers = new DelegatedWorkers({ url: 'http://app:5000/ready', timeoutMs: 2000, fetchImpl });
      try {
        await workers.start();
        runtimeState.update({ acceptingTraffic: true });
        await expect(workers.observe()).resolves.toBe(true);
        expect(fetchImpl).toHaveBeenCalledTimes(3);
        expect(runtimeState.snapshot().workersReady).toBe(true);
      } finally { await workers.stop(); }
    }, 15000);

    test.each(['second timeout', 'explicit unhealthy', 'not yet serving'])(
      'withdraws readiness for %s without unbounded retries', async (scenario) => {
        const fetchImpl = jest.fn()
          .mockImplementationOnce(ready)
          .mockImplementation(scenario === 'explicit unhealthy' ? async () => ({ ok: false, status: 503 }) : missDeadline);
        const workers = new DelegatedWorkers({ url: 'http://app:5000/ready', timeoutMs: 20, fetchImpl });
        try {
          await workers.start();
          runtimeState.update({ acceptingTraffic: scenario !== 'not yet serving' });
          await expect(workers.observe()).resolves.toBe(false);
          expect(fetchImpl).toHaveBeenCalledTimes(scenario === 'second timeout' ? 3 : 2);
          expect(runtimeState.snapshot().workersReady).toBe(false);
        } finally { await workers.stop(); }
      },
    );

    test('a timed-out initial observation refuses startup', async () => {
      const fetchImpl = jest.fn(missDeadline);
      const workers = new DelegatedWorkers({ url: 'http://app:5000/ready', timeoutMs: 20, fetchImpl });
      await expect(workers.start()).rejects.toThrow('web replacement refused');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(runtimeState.snapshot().workersReady).toBe(false);
    });
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
