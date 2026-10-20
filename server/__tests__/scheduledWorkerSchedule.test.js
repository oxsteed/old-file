'use strict';

describe('scheduled worker shutdown', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.dontMock('../jobs/jobLockingService');
    jest.resetModules();
  });

  test('stop drains an in-flight scheduled run before resolving', async () => {
    jest.useFakeTimers();
    jest.doMock('../jobs/jobLockingService', () => ({
      withFencedJobLock: jest.fn((_name, fn) => fn({ assertActive() {} })),
    }));
    const { startScheduledWorkers } = require('../workers/scheduledWorkerSchedule');
    let finish;
    const worker = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
    const log = { info: jest.fn(), error: jest.fn() };
    const handle = startScheduledWorkers({
      log,
      schedule: [['growth-demo', worker, 100, {}]],
    });

    jest.advanceTimersByTime(100);
    await Promise.resolve();
    expect(worker).toHaveBeenCalledTimes(1);

    let drained = false;
    const stopping = handle.stop().then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);

    finish({ stored: 1 });
    await stopping;
    expect(drained).toBe(true);
    expect(handle.size).toBe(0);
    jest.advanceTimersByTime(500);
    expect(worker).toHaveBeenCalledTimes(1);
  });
});
