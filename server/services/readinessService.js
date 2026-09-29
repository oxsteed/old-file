'use strict';

const fs = require('fs');
const path = require('path');
const runtimeState = require('./runtimeState');
const logger = require('../utils/logger');
const { getCreditRailPrerequisites, getLedgerHashKeyConfiguration } = require('./oxsteedCreditService');
const { getProductionConfigurationErrors } = require('../utils/validateEnv');
const { getRelease } = require('../utils/release');

const migrationsDirectory = path.join(__dirname, '../migrations');

const ADMIN_CONTROL_PLANE_SCHEMA = Object.freeze({
  admin_audit_log: ['target_key'],
  platform_settings: ['min_numeric_value', 'max_numeric_value', 'validation_pattern', 'version'],
});

function creditLedgerReadiness() {
  const dedicatedSecret = process.env.OXSTEED_CREDIT_LEDGER_HMAC_SECRET;
  const fallbackSecret = process.env.JWT_SECRET;
  const production = (process.env.NODE_ENV || 'production') === 'production';
  const secret = production ? dedicatedSecret : (dedicatedSecret || fallbackSecret);
  const ok = typeof secret === 'string' && secret.length >= 32;
  let keyConfiguration = null;
  let configurationError;
  try {
    keyConfiguration = getLedgerHashKeyConfiguration();
  } catch (error) {
    configurationError = error.message;
  }
  return {
    ok: ok && !configurationError,
    configured: Boolean(secret),
    dedicatedSecret: Boolean(dedicatedSecret),
    keyVersion: keyConfiguration?.currentVersion,
    previousKeyCount: keyConfiguration?.previousVersions.length || 0,
    error: configurationError || (ok ? undefined : 'Credit ledger signing secret is missing or weak'),
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
  const unexpected = [...applied].filter((filename) => !expected.includes(filename)).sort();
  return {
    ok: pending.length === 0 && unexpected.length === 0,
    expected: expected.length,
    applied: expected.length - pending.length,
    pendingCount: pending.length,
    unexpectedCount: unexpected.length,
    ...(unexpected.length > 0 ? { error: 'database contains migrations not present in this release' } : {}),
  };
}

async function adminControlPlaneSchemaStatus(pool) {
  // Development and test databases intentionally use lightweight mocks or
  // older schemas. Production readiness must validate the additive control
  // plane contract because runtime settings/audit paths depend on it.
  if ((process.env.NODE_ENV || 'production') !== 'production') {
    return { ok: true, skipped: true };
  }

  const entries = Object.entries(ADMIN_CONTROL_PLANE_SCHEMA);
  const predicates = entries.map(([table], index) =>
    `(table_name = $${index + 1} AND column_name = ANY($${index + 1 + entries.length}::text[]))`
  );
  const params = [
    ...entries.map(([table]) => table),
    ...entries.map(([, columns]) => columns),
  ];
  const { rows } = await pool.query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (${predicates.join(' OR ')})`,
    params,
  );
  const present = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
  const missing = entries.flatMap(([table, columns]) =>
    columns.filter((column) => !present.has(`${table}.${column}`)).map((column) => `${table}.${column}`)
  );
  return missing.length
    ? { ok: false, error: 'admin control-plane schema contract is incomplete', missing }
    : { ok: true };
}

async function checkReadiness({ pool, redis, includeTrafficState = true }) {
  const runtime = runtimeState.snapshot();
  const productionConfigurationErrors = getProductionConfigurationErrors();
  const release = getRelease();
  const production = (process.env.NODE_ENV || 'production') === 'production';
  const result = {
    status: 'ready',
    timestamp: new Date().toISOString(),
    // Release identifiers are safe operational metadata; never expose secrets
    // or the full deployment environment through readiness.
    release,
    checks: {
      release: {
        ok: !production || Boolean(String(release || '').trim()),
        ...(!production || Boolean(String(release || '').trim()) ? {} : { error: 'release identifier is missing' }),
      },
      productionConfiguration: {
        ok: productionConfigurationErrors.length === 0,
        ...(productionConfigurationErrors.length > 0
          ? { error: 'unsafe production environment configuration' }
          : {}),
      },
      database: { ok: false },
      migrations: { ok: false },
      adminControlPlane: { ok: false },
      redis: { ok: true, configured: Boolean(process.env.REDIS_URL) },
      creditLedger: creditLedgerReadiness(),
      creditRail: { ok: true, enabled: false, requiresSharedRedis: false },
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
      result.checks.adminControlPlane = await adminControlPlaneSchemaStatus(pool);
    } catch (err) {
      result.checks.migrations = { ok: false, error: 'migration state unavailable' };
      result.checks.adminControlPlane = { ok: false, error: 'admin control-plane schema unavailable' };
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

  if (result.checks.database.ok) {
    try {
      const { rows } = await pool.query(
        `SELECT is_enabled
           FROM feature_flags
          WHERE key = 'oxsteed_credit_enabled'
          LIMIT 1`
      );
      const enabled = rows[0]?.is_enabled === true;
      result.checks.creditRail = {
        ok: !enabled || (
          result.checks.redis.configured
          && result.checks.redis.ok
          && getCreditRailPrerequisites().readyForProductionActivation
        ),
        enabled,
        requiresSharedRedis: enabled,
        ...(enabled && !result.checks.redis.configured
          ? { error: 'Shared Redis is required before enabling OxSteed Credit' }
          : {}),
        ...(enabled && result.checks.redis.configured && !result.checks.redis.ok
          ? { error: 'Configured Redis is unavailable while OxSteed Credit is enabled' }
          : {}),
        ...(enabled && result.checks.redis.configured && result.checks.redis.ok && !getCreditRailPrerequisites().dedicatedLedgerSecretConfigured
          ? { error: 'A dedicated Credit ledger secret is required before enabling OxSteed Credit' }
          : {}),
        ...(enabled && result.checks.redis.configured && result.checks.redis.ok && !getCreditRailPrerequisites().ledgerKeyConfigurationValid
          ? { error: 'Credit ledger key rotation configuration is invalid' }
          : {}),
        ...(enabled && result.checks.redis.configured && result.checks.redis.ok && !getCreditRailPrerequisites().serverErrorMonitoringConfigured
          ? { error: 'Server error monitoring is required before enabling OxSteed Credit' }
          : {}),
      };
    } catch (err) {
      result.checks.creditRail = {
        ok: false,
        enabled: false,
        requiresSharedRedis: false,
        error: 'Credit rail status unavailable',
      };
      logger.error('Readiness Credit rail check failed', { message: err.message });
    }
  }

  if (Object.values(result.checks).some((check) => !check.ok)) {
    result.status = 'not_ready';
  }

  return result;
}

module.exports = { checkReadiness, expectedMigrationFiles, migrationStatus, adminControlPlaneSchemaStatus };
