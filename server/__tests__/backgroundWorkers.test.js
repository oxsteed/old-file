'use strict';

const cron = require('node-cron');
const { BackgroundWorkers } = require('../bootstrap/backgroundWorkers');

describe('BackgroundWorkers', () => {
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
