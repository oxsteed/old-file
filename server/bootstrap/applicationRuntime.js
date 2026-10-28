'use strict';

const logger = require('../utils/logger');
const runtimeState = require('../services/runtimeState');
const { checkReadiness } = require('../services/readinessService');
const { runtimeRole } = require('../utils/runtimeRole');
const { setTimeout: delay } = require('node:timers/promises');

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
  constructor({ httpServer, realtime, pool, redis, log = logger, workers, drain } = {}) {
    if (!httpServer || !realtime || !pool) {
      throw new TypeError('ApplicationRuntime requires httpServer, realtime, and pool');
    }
    this.httpServer = httpServer;
    this.realtime = realtime;
    this.pool = pool;
    this.redis = redis;
    this.log = log;
    this.role = runtimeRole();
    // Web routing checks /ready every second. Keep existing HTTP requests and
    // connections alive while the proxy withdraws this instance from routing.
    this.drain = drain || (() => this.role === 'web' ? delay(5000) : Promise.resolve());
    // Do not import the job registry into a web-only replacement. Imported
    // job modules must not accidentally register consumers before prepare().
    this.workers = workers || (this.role === 'web'
      ? new (require('./delegatedWorkers').DelegatedWorkers)()
      : new (require('./backgroundWorkers').BackgroundWorkers)({ log }));
    this.shutdownPromise = null;
    runtimeState.update({ realtimeReady: typeof realtime.ready !== 'function' });
  }

  async prepare() {
    if (this.role === 'web' && !process.env.REDIS_URL) {
      throw new Error('Web replacements require shared Redis for cross-process realtime and session coordination.');
    }
    if (typeof this.realtime.ready === 'function') {
      const ready = await this.realtime.ready();
      runtimeState.update({ realtimeReady: ready === true });
      if (!ready) throw new Error('Realtime coordination is not ready; application startup refused.');
    }
    const dependencies = await checkReadiness({
      pool: this.pool,
      redis: this.redis,
      includeTrafficState: false,
    });
    // Workers are intentionally not started until durable dependencies and
    // migration state have been verified.
    dependencies.checks.workers.ok = true;
    if (Object.entries(dependencies.checks).some(([name, check]) => (
      name !== 'workers' && check.requiredForTraffic !== false && !check.ok
    ))) {
      throw new Error(`Application dependencies are not ready: ${JSON.stringify(dependencies.checks)}`);
    }

    await this.workers.start();
    runtimeState.update({ workersReady: true, workerMode: this.role === 'web' ? 'delegated' : 'combined' });
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

      if (this.httpServer.listening) await this.drain();
      await this.workers.stop();
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
