'use strict';

const fs = require('fs');
const path = require('path');
const runtimeState = require('./runtimeState');
const logger = require('../utils/logger');

const migrationsDirectory = path.join(__dirname, '../migrations');

function creditLedgerReadiness() {
  const dedicatedSecret = process.env.OXSTEED_CREDIT_LEDGER_HMAC_SECRET;
  const fallbackSecret = process.env.JWT_SECRET;
  const production = (process.env.NODE_ENV || 'production') === 'production';
  const secret = production ? dedicatedSecret : (dedicatedSecret || fallbackSecret);
  const ok = typeof secret === 'string' && secret.length >= 32;
  return {
    ok,
    configured: Boolean(secret),
    dedicatedSecret: Boolean(dedicatedSecret),
    error: ok ? undefined : 'Credit ledger signing secret is missing or weak',
  };
}

function expectedMigrationFiles() {
  return fs.readdirSync(migrationsDirectory).filter((file) => file.endsWith('.sql')).sort();
}

async function migrationStatus(pool) {
  const expected = expectedMigrationFiles();
  const { rows } = await pool.query('SELECT filename FROM _migrations');
  const applied = new Set(rows.map((row) => row.filename));
  const pending = expected.filter((filename) => !applied.has(filename));
  return {
    ok: pending.length === 0,
    expected: expected.length,
    applied: expected.length - pending.length,
    pendingCount: pending.length,
  };
}

async function checkReadiness({ pool, redis, includeTrafficState = true }) {
  const runtime = runtimeState.snapshot();
  const result = {
    status: 'ready',
    timestamp: new Date().toISOString(),
    checks: {
      database: { ok: false },
      migrations: { ok: false },
      redis: { ok: true, configured: Boolean(process.env.REDIS_URL) },
      creditLedger: creditLedgerReadiness(),
      realtime: { ok: runtime.realtimeReady },
      workers: { ok: runtime.workersReady },
      traffic: { ok: includeTrafficState ? runtime.acceptingTraffic : true },
      shutdown: { ok: !runtime.shuttingDown },
    },
  };

  try {
    await pool.query('SELECT 1');
    result.checks.database.ok = true;
  } catch (err) {
    result.checks.database.error = 'database unreachable';
    logger.error('Readiness database check failed', { message: err.message });
  }

  if (result.checks.database.ok) {
    try {
      result.checks.migrations = await migrationStatus(pool);
    } catch (err) {
      result.checks.migrations = { ok: false, error: 'migration state unavailable' };
      logger.error('Readiness migration check failed', { message: err.message });
    }
  }

  if (process.env.REDIS_URL) {
    try {
      if (!redis) throw new Error('Redis client unavailable');
      result.checks.redis.ok = (await redis.ping()) === 'PONG';
      if (!result.checks.redis.ok) result.checks.redis.error = 'redis ping failed';
    } catch (err) {
      result.checks.redis.ok = false;
      result.checks.redis.error = 'redis unavailable';
      logger.error('Readiness Redis check failed', { message: err.message });
    }
  }

  if (Object.values(result.checks).some((check) => !check.ok)) {
    result.status = 'not_ready';
  }

  return result;
}

module.exports = { checkReadiness, expectedMigrationFiles, migrationStatus };
