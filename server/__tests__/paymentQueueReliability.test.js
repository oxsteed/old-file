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
    redis.set.mockResolvedValueOnce('OK');
    redis.lpush.mockResolvedValueOnce(1);

    await paymentQueue.addJob(paymentQueue.QUEUES.PAYMENT_CAPTURE, { paymentId: 7 }, 'capture-7');
    await paymentQueue.addJob(paymentQueue.QUEUES.PAYMENT_CAPTURE, { paymentId: 7 }, 'capture-7');

    expect(redis.set).toHaveBeenCalledTimes(2);
    expect(redis.set.mock.calls[0]).toEqual(['job:capture-7:enqueued', '1', 'EX', 86400, 'NX']);
    expect(redis.lpush).toHaveBeenCalledTimes(1);
  });

  test('promotes each due retry payload only once across workers', async () => {
    const payload = JSON.stringify({ id: 'job-1', attempts: 1 });
    redis.zrangebyscore.mockResolvedValueOnce([payload, payload]);
    redis.zrem.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    redis.lpush.mockResolvedValueOnce(1);

    await expect(paymentQueue.promoteDueRetries(paymentQueue.QUEUES.STRIPE_WEBHOOK)).resolves.toBe(1);
    expect(redis.zrem).toHaveBeenCalledTimes(2);
    expect(redis.lpush).toHaveBeenCalledTimes(1);
    expect(redis.lpush).toHaveBeenCalledWith(paymentQueue.QUEUES.STRIPE_WEBHOOK, payload);
  });

  test('recognizes completed jobs so stale duplicate payloads can be skipped', async () => {
    redis.get.mockResolvedValueOnce('1');
    await expect(paymentQueue.isJobCompleted('webhook-evt-1')).resolves.toBe(true);
    expect(redis.get).toHaveBeenCalledWith('job:webhook-evt-1:complete');
  });
});
