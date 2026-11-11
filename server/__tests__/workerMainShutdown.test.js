'use strict';

// Keep this lifecycle regression isolated from workerMain.test.js so the
// tracking schedule can be reduced to one controllable pass.
const queueMocks = {
  QUEUES: {
    PAYMENT_CAPTURE: 'queue:payment-capture',
    STRIPE_WEBHOOK: 'queue:stripe-webhook',
    NOTIFICATIONS: 'queue:notifications',
  },
  getNextJob: jest.fn(),
  retryJob: jest.fn(),
  deadLetterJob: jest.fn(),
  completeJob: jest.fn(),
  promoteDueRetries: jest.fn(),
  isJobCompleted: jest.fn(),
  renewJobLease: jest.fn(),
  getVisibilityTimeoutMs: jest.fn(() => 30000),
  closeQueue: jest.fn().mockResolvedValue(undefined),
};

const workerMocks = {
  processPaymentCapture: jest.fn(),
  processStripeWebhook: jest.fn(),
  processNotification: jest.fn(),
};

let mockScheduledRun;
const scheduledWorkerMocks = {
  SCHEDULED_WORKERS: [['tracking-pass', jest.fn(), 1000, {}]],
  runScheduledWorkerOnce: jest.fn(() => mockScheduledRun),
};

jest.doMock('../services/paymentQueue', () => queueMocks);
jest.doMock('../workers/paymentWorker', () => workerMocks);
jest.doMock('../modules/jobs/translationJobWorker', () => ({ pollTranslationJobs: jest.fn() }));
jest.doMock('../workers/scheduledWorkerSchedule', () => scheduledWorkerMocks);
jest.doMock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { runWorker, shutdown } = require('../workerMain');

test('shutdown waits for an in-flight tracking pass before closing resources', async () => {
  jest.useFakeTimers();
  jest.spyOn(process, 'exit').mockImplementation(() => {});
  queueMocks.getNextJob.mockResolvedValue(null);

  let releaseTracking;
  mockScheduledRun = new Promise((resolve) => { releaseTracking = resolve; });
  await runWorker();
  jest.advanceTimersByTime(1000);
  await Promise.resolve();
  await Promise.resolve();
  expect(scheduledWorkerMocks.runScheduledWorkerOnce).toHaveBeenCalledTimes(1);

  const stopping = shutdown('SIGTERM');
  await Promise.resolve();
  expect(queueMocks.closeQueue).not.toHaveBeenCalled();

  releaseTracking();
  await Promise.resolve();
  await Promise.resolve();
  await jest.advanceTimersByTimeAsync(100);
  await stopping;

  expect(queueMocks.closeQueue).toHaveBeenCalledTimes(1);
  expect(process.exit).toHaveBeenCalledWith(0);
  jest.useRealTimers();
});
