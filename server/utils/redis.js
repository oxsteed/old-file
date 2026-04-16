/**
 * Shared Redis client for OxSteed server.
 *
 * Exports a single ioredis instance (or null when REDIS_URL is not set).
 * Import this everywhere Redis is needed — rateLimiter, helperContext, threadMemory —
 * so the process holds only one TCP connection to the Redis server.
 *
 * Usage:
 *   const redis = require('../utils/redis');
 *   if (redis) await redis.get('key');  // always guard with null check
 */

const logger = require('./logger');

let client = null;

if (process.env.REDIS_URL) {
  try {
    const Redis = require('ioredis');
    client = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableOfflineQueue: true,
      lazyConnect: true,
      retryStrategy(times) {
        if (times > 3) return null; // stop retrying
        return Math.min(times * 200, 2000);
      },
    });
    client.connect()
      .then(() => logger.info('Redis: connected'))
      .catch(err => {
        logger.warn('Redis: connect failed — Redis features disabled', { message: err.message });
        client = null;
      });
    client.on('error', err => logger.warn('Redis: error', { message: err.message }));
  } catch (err) {
    logger.warn('Redis: initialization failed — Redis features disabled', { message: err.message });
    client = null;
  }
} else {
  logger.info('Redis: REDIS_URL not set — Redis features disabled (in-memory rate limiting only)');
}

module.exports = client;
