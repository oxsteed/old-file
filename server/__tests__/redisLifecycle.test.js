'use strict';

describe('shared Redis lifecycle', () => {
  afterEach(() => {
    delete process.env.REDIS_URL;
    jest.dontMock('ioredis');
    jest.resetModules();
  });

  test('keeps the configured client available so it can reconnect after a transient outage', async () => {
    process.env.REDIS_URL = 'redis://isolated-redis:6379';
    const fakeClient = {
      connect: jest.fn().mockRejectedValue(new Error('Redis is restarting')),
      on: jest.fn(),
    };
    const Redis = jest.fn().mockReturnValue(fakeClient);
    jest.doMock('ioredis', () => Redis);

    const redis = require('../utils/redis');
    await Promise.resolve();

    expect(redis).toBe(fakeClient);
    expect(Redis).toHaveBeenCalledWith('redis://isolated-redis:6379', expect.objectContaining({
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      retryStrategy: expect.any(Function),
    }));
    expect(Redis.mock.calls[0][1].retryStrategy(20)).toBe(4000);
    expect(fakeClient.on).toHaveBeenCalledWith('error', expect.any(Function));
  });
});
