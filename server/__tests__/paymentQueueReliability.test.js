'use strict';

const { resetMocks } = require('./setup');
jest.unmock('../services/paymentQueue');
const paymentQueue = require('../services/paymentQueue');

const redis = paymentQueue.redis;

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('payment queue reliability', () => {
  test('suppresses duplicate enqueue requests with an atomic marker', async () => {
    redis.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await paymentQueue.addJob(paymentQueue.QUEUES.PAYMENT_CAPTURE, { paymentId: 7 }, 'capture-7');
    await paymentQueue.addJob(paymentQueue.QUEUES.PAYMENT_CAPTURE, { paymentId: 7 }, 'capture-7');

    expect(redis.eval).toHaveBeenCalledTimes(2);
    expect(redis.eval.mock.calls[0][1]).toBe(2);
    expect(redis.eval.mock.calls[0].slice(2)).toEqual([
      'job:capture-7:enqueued',
      paymentQueue.QUEUES.PAYMENT_CAPTURE,
      expect.any(String),
      86400,
    ]);
  });

  test('promotes each due retry payload only once across workers', async () => {
    const payload = JSON.stringify({ id: 'job-1', attempts: 1 });
    redis.zrangebyscore.mockResolvedValueOnce([payload, payload]);
    redis.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(paymentQueue.promoteDueRetries(paymentQueue.QUEUES.STRIPE_WEBHOOK)).resolves.toBe(1);
    expect(redis.eval).toHaveBeenCalledTimes(2);
    expect(redis.eval.mock.calls[0]).toEqual([
      expect.stringContaining("redis.call('ZREM'"),
      2,
      'queue:stripe-webhook:delayed',
      'queue:stripe-webhook',
      payload,
    ]);
  });

  test('recognizes completed jobs so stale duplicate payloads can be skipped', async () => {
    redis.get.mockResolvedValueOnce('1');
    await expect(paymentQueue.isJobCompleted('webhook-evt-1')).resolves.toBe(true);
    expect(redis.get).toHaveBeenCalledWith('job:webhook-evt-1:complete');
  });

  test('reclaims jobs whose worker lease expired after a crash', async () => {
    redis.eval.mockResolvedValueOnce(2);

    await expect(paymentQueue.reclaimStaleJobs(paymentQueue.QUEUES.PAYMENT_CAPTURE)).resolves.toBe(2);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('LREM'"),
      3,
      'queue:payment-capture:leases',
      'queue:payment-capture:processing',
      paymentQueue.QUEUES.PAYMENT_CAPTURE,
      expect.any(Number),
      25,
    );
  });

  test('does not duplicate a retry when stale-job reclamation already won', async () => {
    const job = { id: 'capture-race', attempts: 0, data: { paymentId: 9 } };
    Object.defineProperty(job, '__queuePayload', { value: JSON.stringify(job), enumerable: false });
    redis.eval.mockResolvedValueOnce(0);

    await expect(paymentQueue.retryJob(paymentQueue.QUEUES.PAYMENT_CAPTURE, job)).resolves.toBe(true);
    expect(redis.zadd).not.toHaveBeenCalled();
  });

  test('atomically acknowledges and marks a completed claimed job', async () => {
    const job = { id: 'capture-complete', attempts: 0, data: { paymentId: 10 } };
    Object.defineProperty(job, '__queuePayload', { value: JSON.stringify(job), enumerable: false });
    redis.eval.mockResolvedValueOnce(1);

    await paymentQueue.completeJob(paymentQueue.QUEUES.PAYMENT_CAPTURE, job);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('SET'"),
      3,
      'queue:payment-capture:processing',
      'queue:payment-capture:leases',
      'job:capture-complete:complete',
      JSON.stringify(job),
      86400,
    );
    expect(redis.setex).not.toHaveBeenCalled();
  });

  test('propagates acknowledgment failures so the worker can retry the job', async () => {
    const job = { id: 'capture-ack-failed', attempts: 0, data: { paymentId: 11 } };
    Object.defineProperty(job, '__queuePayload', { value: JSON.stringify(job), enumerable: false });
    const error = new Error('Redis unavailable');
    redis.eval.mockRejectedValueOnce(error);

    await expect(paymentQueue.completeJob(paymentQueue.QUEUES.PAYMENT_CAPTURE, job)).rejects.toThrow('Redis unavailable');
  });

  test('preserves exhausted jobs in a dead-letter queue for operator recovery', async () => {
    const job = { id: 'webhook-evt-failed', attempts: 3, data: { eventType: 'payment_intent.succeeded' } };
    redis.eval.mockResolvedValueOnce(1);

    await expect(paymentQueue.deadLetterJob(
      paymentQueue.QUEUES.STRIPE_WEBHOOK,
      job,
      new Error('Stripe API unavailable')
    )).resolves.toBe(true);

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('SET'"),
      2,
      'job:webhook-evt-failed:dead-letter',
      'queue:stripe-webhook:dead-letter',
      expect.stringMatching(/"status":"dead-lettered"/),
      86400,
    );
    expect(redis.eval.mock.calls[0][4]).toContain('Stripe API unavailable');
  });

  test('atomically requeues a selected dead-letter job with a fresh retry budget', async () => {
    const job = {
      id: 'webhook-evt-recover',
      attempts: 3,
      status: 'dead-lettered',
      deadLetteredAt: 123,
      lastError: 'Stripe API unavailable',
      data: { eventType: 'payment_intent.succeeded' },
    };
    redis.lrange.mockResolvedValueOnce([JSON.stringify(job)]);
    redis.eval.mockResolvedValueOnce(1);

    await expect(paymentQueue.requeueDeadLetterJob(
      paymentQueue.QUEUES.STRIPE_WEBHOOK,
      job.id
    )).resolves.toMatchObject({
      id: job.id,
      status: 'pending',
      attempts: 0,
      recoveredFromDeadLetter: {
        deadLetteredAt: 123,
        attempts: 3,
        lastError: 'Stripe API unavailable',
      },
    });
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('LREM'"),
      4,
      'queue:stripe-webhook:dead-letter',
      'queue:stripe-webhook',
      'job:webhook-evt-recover:dead-letter',
      'job:webhook-evt-recover:complete',
      JSON.stringify(job),
      expect.stringMatching(/"status":"pending"/),
    );
  });
});
