'use strict';

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
  closeQueue: jest.fn(),
};

const processorMocks = {
  processPaymentCapture: jest.fn(),
  processStripeWebhook: jest.fn(),
  processNotification: jest.fn(),
};

jest.unmock('../workerMain');
jest.doMock('../services/paymentQueue', () => queueMocks);
jest.doMock('../workers/paymentWorker', () => processorMocks);
jest.doMock('../modules/jobs/translationJobWorker', () => ({ pollTranslationJobs: jest.fn() }));
jest.doMock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { processJob } = require('../workerMain');

beforeEach(() => {
  jest.clearAllMocks();
});

test('acknowledges a claimed duplicate job instead of leaving it for stale reclaim', async () => {
  queueMocks.isJobCompleted.mockResolvedValue(true);
  const job = { id: 'duplicate-webhook', attempts: 0 };

  await expect(processJob(queueMocks.QUEUES.STRIPE_WEBHOOK, job)).resolves.toBeUndefined();

  expect(processorMocks.processStripeWebhook).not.toHaveBeenCalled();
  expect(queueMocks.completeJob).toHaveBeenCalledWith(queueMocks.QUEUES.STRIPE_WEBHOOK, job);
  expect(queueMocks.retryJob).not.toHaveBeenCalled();
});

test('dead-letters a claimed job when its queue has no processor', async () => {
  const job = { id: 'unknown-queue-job', attempts: 0 };

  await expect(processJob('queue:unknown', job)).resolves.toBeUndefined();

  expect(queueMocks.deadLetterJob).toHaveBeenCalledWith(
    'queue:unknown',
    job,
    expect.objectContaining({ message: 'No processor configured for queue queue:unknown' }),
  );
  expect(queueMocks.completeJob).not.toHaveBeenCalled();
  expect(queueMocks.retryJob).not.toHaveBeenCalled();
});
