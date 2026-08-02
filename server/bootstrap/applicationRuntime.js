'use strict';

const logger = require('../utils/logger');
const runtimeState = require('../services/runtimeState');
const { checkReadiness } = require('../services/readinessService');
const { BackgroundWorkers } = require('./backgroundWorkers');

function closeHttpServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function closeRedis(redis) {
  if (!redis) return;
  if (redis.status === 'end') return;
  if (typeof redis.quit === 'function') await redis.quit();
}

class ApplicationRuntime {
  constructor({ httpServer, realtime, pool, redis, log = logger, workers } = {}) {
    if (!httpServer || !realtime || !pool) {
      throw new TypeError('ApplicationRuntime requires httpServer, realtime, and pool');
    }
    this.httpServer = httpServer;
    this.realtime = realtime;
    this.pool = pool;
    this.redis = redis;
    this.log = log;
    this.workers = workers || new BackgroundWorkers({ log });
    this.shutdownPromise = null;
    runtimeState.update({ realtimeReady: true });
  }

  async prepare() {
    const dependencies = await checkReadiness({
      pool: this.pool,
      redis: this.redis,
      includeTrafficState: false,
    });
    // Workers are intentionally not started until durable dependencies and
    // migration state have been verified.
    dependencies.checks.workers.ok = true;
    if (Object.entries(dependencies.checks).some(([name, check]) => name !== 'workers' && !check.ok)) {
      throw new Error(`Application dependencies are not ready: ${JSON.stringify(dependencies.checks)}`);
    }

    this.workers.start();
    runtimeState.update({ workersReady: true });
  }

  markListening() {
    runtimeState.update({
      acceptingTraffic: true,
      startedAt: new Date().toISOString(),
    });
  }

  shutdown(signal = 'unknown') {
    if (this.shutdownPromise) return this.shutdownPromise;

    this.shutdownPromise = (async () => {
      runtimeState.update({ acceptingTraffic: false, workersReady: false, shuttingDown: true });
      this.log.info('Graceful shutdown started', { signal });

      this.workers.stop();
      await this.realtime.close();
      runtimeState.update({ realtimeReady: false });
      await closeHttpServer(this.httpServer);
      await closeRedis(this.redis);
      await this.pool.end();
      this.log.info('Graceful shutdown complete', { signal });
    })();

    return this.shutdownPromise;
  }
}

module.exports = { ApplicationRuntime, closeHttpServer, closeRedis };
