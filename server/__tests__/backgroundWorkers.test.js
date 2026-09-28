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
});
