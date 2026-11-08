'use strict';

const cron = require('node-cron');
jest.mock('../services/localDeliveryEventWorker', () => ({
  startLocalDeliveryEventWorker: jest.fn(),
}));
const { startLocalDeliveryEventWorker } = require('../services/localDeliveryEventWorker');
const { BackgroundWorkers } = require('../bootstrap/backgroundWorkers');

describe('BackgroundWorkers', () => {
  test('production bootstrap starts the delivery worker once and waits for its shutdown', async () => {
    let finish;
    const stop = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
    startLocalDeliveryEventWorker.mockReturnValue({ stop });
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const workers = new BackgroundWorkers({ log });
    workers.start();
    expect(startLocalDeliveryEventWorker).toHaveBeenCalledWith({ log });
    expect(() => workers.start()).toThrow('already been started');
    let drained = false;
    const stopping = workers.stop().then(() => { drained = true; });
    await Promise.resolve();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(drained).toBe(false);
    finish();
    await stopping;
    expect(drained).toBe(true);
    expect(workers.status()).toEqual({ started: false, cronTasks: 0, timerWorkers: 0 });
  });

  test('rolls back cron registrations when startup fails partway through', () => {
    const previousCron = process.env.TRANSLATION_JOB_POLL_CRON;
    const before = new Set(cron.getTasks().keys());
    const workers = new BackgroundWorkers({
      log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });

    process.env.TRANSLATION_JOB_POLL_CRON = 'not-a-cron-expression';
    try {
      expect(() => workers.start()).toThrow('Invalid TRANSLATION_JOB_POLL_CRON');
      expect(workers.status()).toEqual({ started: false, cronTasks: 0, timerWorkers: 0 });
      expect(new Set(cron.getTasks().keys())).toEqual(before);
    } finally {
      if (previousCron === undefined) delete process.env.TRANSLATION_JOB_POLL_CRON;
      else process.env.TRANSLATION_JOB_POLL_CRON = previousCron;
      workers.stop();
    }
  });

  test('background-jobs audit, Oct 30 item 28: translation poll cron runs only without a dedicated worker', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const previousDedicated = process.env.DEDICATED_WORKER_PROCESS;
    try {
      delete process.env.DEDICATED_WORKER_PROCESS;
      const apiWorkers = new BackgroundWorkers({ log });
      apiWorkers.start();
      const apiCronTasks = apiWorkers.status().cronTasks;
      apiWorkers.stop();

      process.env.DEDICATED_WORKER_PROCESS = 'true';
      const dedicatedWorkers = new BackgroundWorkers({ log });
      dedicatedWorkers.start();
      const dedicatedCronTasks = dedicatedWorkers.status().cronTasks;
      dedicatedWorkers.stop();

      // Exactly one cron disappears: the translation poller. The fleet
      // is timer-based, not cron-based, so it does not move the count.
      // Before the fix the API polled every 30s while the dedicated
      // worker polled every 1.5s, duplicating every poll tick.
      expect(apiCronTasks).toBeGreaterThan(0);
      expect(apiCronTasks - dedicatedCronTasks).toBe(1);
    } finally {
      if (previousDedicated === undefined) delete process.env.DEDICATED_WORKER_PROCESS;
      else process.env.DEDICATED_WORKER_PROCESS = previousDedicated;
    }
  });

  test('background-jobs audit, Oct 30 item 28: an invalid translation cron is ignored when a dedicated worker polls', () => {
    const previousCron = process.env.TRANSLATION_JOB_POLL_CRON;
    const previousDedicated = process.env.DEDICATED_WORKER_PROCESS;
    const workers = new BackgroundWorkers({
      log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
    process.env.TRANSLATION_JOB_POLL_CRON = 'not-a-cron-expression';
    process.env.DEDICATED_WORKER_PROCESS = 'true';
    try {
      expect(() => workers.start()).not.toThrow();
    } finally {
      if (previousCron === undefined) delete process.env.TRANSLATION_JOB_POLL_CRON;
      else process.env.TRANSLATION_JOB_POLL_CRON = previousCron;
      if (previousDedicated === undefined) delete process.env.DEDICATED_WORKER_PROCESS;
      else process.env.DEDICATED_WORKER_PROCESS = previousDedicated;
      workers.stop();
    }
  });
});
