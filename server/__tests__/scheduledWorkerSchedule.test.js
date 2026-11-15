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

  test('digest entries run on a wall-clock cron in America/New_York', () => {
    // Item 30: emailDigestDaily/Weekly ran on a 24h setInterval from
    // boot, so a restart reset the timer and delivery drifted up to ~24h;
    // the weekly Monday check used UTC day while the weekly summary uses
    // ET Monday, so the two "weekly" sends could land on different days.
    const { SCHEDULED_WORKERS } = require('../workers/scheduledWorkerSchedule');
    const daily = SCHEDULED_WORKERS.find(([name]) => name === 'emailDigestDaily');
    const weekly = SCHEDULED_WORKERS.find(([name]) => name === 'emailDigestWeekly');
    expect(daily).toBeDefined();
    expect(weekly).toBeDefined();
    expect(daily[3]).toMatchObject({ cron: '0 8 * * *', timezone: 'America/New_York' });
    expect(weekly[3]).toMatchObject({ cron: '0 8 * * 1', timezone: 'America/New_York' });
    expect(String(weekly[1])).not.toContain('getUTCDay');
  });

  test('a cron entry fires from the cron schedule, not from a boot interval', async () => {
    jest.useFakeTimers();
    const cronStop = jest.fn();
    const scheduleMock = jest.fn(() => ({ stop: cronStop }));
    jest.doMock('node-cron', () => ({ schedule: scheduleMock }));
    jest.doMock('../jobs/jobLockingService', () => ({
      withFencedJobLock: jest.fn((_name, fn) => fn({ assertActive() {} })),
    }));
    const { startScheduledWorkers } = require('../workers/scheduledWorkerSchedule');
    const worker = jest.fn(() => Promise.resolve({ ok: 1 }));
    const log = { info: jest.fn(), error: jest.fn(), warn: jest.fn() };
    const handle = startScheduledWorkers({
      log,
      schedule: [['digest-cron-test', worker, 24 * 60 * 60 * 1000, { cron: '0 8 * * *', timezone: 'America/New_York' }]],
    });

    expect(scheduleMock).toHaveBeenCalledWith('0 8 * * *', expect.any(Function), { timezone: 'America/New_York' });
    // A full day of fake time must not fire it: no boot-relative interval.
    jest.advanceTimersByTime(25 * 60 * 60 * 1000);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(worker).not.toHaveBeenCalled();

    // Firing the cron callback runs the worker once, fenced.
    await scheduleMock.mock.calls[0][1]();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(worker).toHaveBeenCalledTimes(1);

    handle.stop();
    expect(cronStop).toHaveBeenCalled();
    expect(handle.size).toBe(0);
  });
});
